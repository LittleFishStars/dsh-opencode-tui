/**
 * 会话存储：opencode 会话集合的内存管理 + SSE 推送 + 模型选择。
 *
 * 从 oc-server.ts 拆出。职责：
 * - 会话生命周期：getOrCreate / hydrate（DSH 持久层重建）/ 删除
 * - 事件推送：SSE 连接集合、legacy 事件信封、session.updated 通知
 * - 模型选择：全局 selection / 会话切换模型 / provider 模型目录缓存
 * - 查询：按 DSH session id 反查、按消息 id 查消息
 */
import type { ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { makeSessionInfo, type ModelRef, type SessionInfo } from "./oc-proto.js";
import { viewsToLegacyMessages } from "./projection.js";
import { agentOfPreset, DEFAULT_AGENT, type OutgoingEvent, type SessionState } from "./types.js";
import { ocLog } from "./logging.js";

/** DSH 会话 id → 稳定 opencode 会话 id（重启后保持一致）。 */
export function ocIdFromDsh(dshSessionId: string): string {
  return "ses_" + createHash("sha1").update(dshSessionId).digest("hex").slice(0, 20);
}

export function projectIdOf(directory: string): string {
  return createHash("sha1").update(directory).digest("hex");
}

export interface SessionStoreOptions {
  directory: string;
  /** 获取当前模型选择（provider/model） */
  getSelection: () => { provider: string; model: string } | undefined;
  /** 列出某 provider 可用的全部模型（模型选择窗口的数据源） */
  listModels?: (provider: string) => Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number }>>;
  /** 查询 DSH 会话投影（启动时重建历史） */
  listDshSessions?: () => Promise<
    Array<{
      sessionId: string;
      title: string;
      preset?: string;
      views: import("./projection.js").MessageView[];
      todos: Array<{ id: string; content: string; status: string; priority: string }>;
      diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }>;
    }>
  >;
}

export class SessionStore {
  readonly sessions = new Map<string, SessionState>();
  readonly globalSse = new Set<ServerResponse>();
  private opts: SessionStoreOptions;
  private modelCache: ModelRef | undefined;
  /** 最近一次请求头里的模型上下文窗口（maxTokens；供 limit.context 百分比计算） */
  modelContext: number | undefined;
  /** provider → 模型目录缓存（listModels 结果） */
  private modelsCache = new Map<string, Array<{ id: string; name: string; description?: string; contextWindow?: number }>>();
  /** 历史会话重建 promise：会话列表/详情请求等待它完成，避免 hydrate 前返回空列表。 */
  private hydratePromise: Promise<void> | undefined;

  constructor(_ctx: Context, opts: SessionStoreOptions) {
    this.opts = opts;
  }

  /** 预热模型缓存 + 异步重建历史会话（列表/详情请求会等待）。 */
  init(): void {
    const selection = this.opts.getSelection();
    if (selection) this.modelCache = { id: selection.model, providerID: selection.provider };
    this.hydratePromise = this.runHydrate();
  }

  private async runHydrate(): Promise<void> {
    const list = (await this.opts.listDshSessions?.()) ?? [];
    for (const item of list) {
      try {
        this.hydrateSession(item.sessionId, item.title, item.preset, item.views, item.todos ?? [], item.diffs ?? []);
      } catch (error) {
        ocLog(`[oc-server] hydrate ${item.sessionId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    ocLog(`[oc-server] hydrated ${list.length} sessions`);
  }

  /** 等待历史会话重建完成（带超时兜底，避免 hydrate 挂起卡住请求）。 */
  async waitHydrate(): Promise<void> {
    if (!this.hydratePromise) return;
    try {
      await Promise.race([
        this.hydratePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref?.()),
      ]);
    } catch {
      /* hydrate 失败不阻塞 */
    }
  }

  // ── 会话生命周期 ─────────────────────────────────────────────────────────

  getOrCreateSession(id: string, directory: string): SessionState {
    let state = this.sessions.get(id);
    if (!state) {
      state = {
        id,
        directory,
        title: "New Session",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        busy: false,
        currentAgent: DEFAULT_AGENT,
        messages: [],
        sse: new Set(),
        permissions: new Map(),
        questions: new Map(),
        todos: [],
        diffs: [],
      };
      this.sessions.set(id, state);
    }
    return state;
  }

  /** 把 DSH 会话视图重建为 opencode 会话状态（进程内；ocSessionId 由 dshSessionId 稳定哈希）。 */
  hydrateSession(
    dshSessionId: string,
    title: string,
    preset: string | undefined,
    views: import("./projection.js").MessageView[],
    todos: Array<{ id: string; content: string; status: string; priority: string }>,
    diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }>,
  ): void {
    const ocSessionId = ocIdFromDsh(dshSessionId);
    const existing = this.sessions.get(ocSessionId);
    const state = existing ?? this.getOrCreateSession(ocSessionId, this.opts.directory);
    state.dshSessionId = dshSessionId;
    if (title) state.title = title;
    if (preset) state.currentAgent = agentOfPreset(preset);
    if (todos.length > 0) state.todos = todos;
    if (diffs.length > 0) state.diffs = diffs;
    if (existing) return;
    state.messages = viewsToLegacyMessages(ocSessionId, views, this.selection(), state.currentAgent);
    for (const m of state.messages) {
      state.updatedAt = Math.max(state.updatedAt, m.info.time.updated ?? m.info.time.created);
    }
  }

  /** 删除会话：从内存移除 + 通知 TUI。返回是否成功。 */
  removeSession(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) return true; // 已不存在视为成功
    this.sessions.delete(sessionId);
    // 通知 TUI：从会话列表移除（sync.data.session 的 session.deleted 分支）
    this.pushEvent(
      {
        type: "session.deleted",
        properties: { sessionID: sessionId, info: { id: sessionId } },
      },
      state.directory,
    );
    ocLog(`[oc-server] deleted session ${sessionId}`);
    return true;
  }

  // ── 查询 ─────────────────────────────────────────────────────────────────

  findByDsh(dshSessionId: string): SessionState | undefined {
    for (const state of this.sessions.values()) {
      if (state.dshSessionId === dshSessionId) return state;
    }
    return undefined;
  }

  findMessage(state: SessionState, messageId: string) {
    return state.messages.find((m) => m.info.id === messageId);
  }

  getSessionIdByDsh(dshSessionId: string): string | undefined {
    return this.findByDsh(dshSessionId)?.id;
  }

  // ── 模型选择 ─────────────────────────────────────────────────────────────

  selection(): ModelRef | undefined {
    const sel = this.opts.getSelection();
    if (sel) return { id: sel.model, providerID: sel.provider };
    return this.modelCache;
  }

  /** 会话模型：会话切换的模型优先，否则全局 selection。 */
  sessionModel(state: SessionState): ModelRef | undefined {
    return state.currentModel ?? this.selection();
  }

  /** 列出 provider 的全部模型（带缓存）。 */
  async listModels(provider: string): Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number }>> {
    if (!this.opts.listModels) return [];
    const cached = this.modelsCache.get(provider);
    if (cached) return cached;
    try {
      const models = await this.opts.listModels(provider);
      this.modelsCache.set(provider, models);
      return models;
    } catch {
      return [];
    }
  }

  // ── 会话信息聚合（侧边栏 Context/输入框 meta 的数据源）──────────────────

  infoOf(state: SessionState): SessionInfo {
    // 聚合会话级 token/成本（侧边栏 Context 区、输入框 meta 行的 session.cost）
    const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    let cost = 0;
    for (const m of state.messages) {
      if (m.info.role !== "assistant" || !m.info.tokens) continue;
      tokens.input += m.info.tokens.input;
      tokens.output += m.info.tokens.output;
      tokens.reasoning += m.info.tokens.reasoning;
      tokens.cache.read += m.info.tokens.cache.read;
      tokens.cache.write += m.info.tokens.cache.write;
      cost += m.info.cost ?? 0;
    }
    return makeSessionInfo({
      id: state.id,
      directory: state.directory,
      title: state.title,
      agent: state.currentAgent,
      model: this.sessionModel(state),
      cost,
      tokens,
      created: state.createdAt,
      updated: state.updatedAt,
    });
  }

  // ── SSE 推送 ─────────────────────────────────────────────────────────────

  /** 推旧协议事件（{directory, payload: {type, properties}}）到全局事件流。 */
  pushEvent(event: OutgoingEvent, directory: string): void {
    if (process.env.DSH_OC_NO_EVENTS === "1") return;
    const payload = JSON.stringify({
      directory,
      payload: { type: event.type, properties: event.properties },
    });
    for (const res of this.globalSse) {
      try {
        res.write(`event: ${event.type}\ndata: ${payload}\n\n`);
      } catch {
        /* 断连由 close 清理 */
      }
    }
  }

  pushSessionEvent(state: SessionState, event: OutgoingEvent): void {
    this.pushEvent(event, state.directory);
  }

  /** 会话变更通知（新会话进 sync.data.session、聚合 token/cost 刷新）。 */
  touchSession(state: SessionState): void {
    state.updatedAt = Date.now();
    this.pushSessionEvent(state, {
      type: "session.updated",
      properties: { info: this.infoOf(state) },
    });
  }
}
