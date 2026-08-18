/**
 * opencode server 协议兼容层：HTTP 服务外观。
 *
 * 职责边界（按功能拆分，见各模块）：
 * - `types.ts`        协议类型与常量
 * - `session-store.ts` 会话存储（生命周期/SSE 推送/模型选择）
 * - `event-mapper.ts`  DSH 事件 → opencode 事件（handleDshEvent/审批/提问）
 * - `routes/api.ts`   v2 路由（/api/*）
 * - `routes/legacy.ts` 旧协议路由（/session/:id/* 与杂项旧路径）
 * - `http-util.ts`    HTTP 工具（JSON/SSE/body）
 * - `oc-proto.ts`     协议对象构造（located/sessionInfo/model/agent）
 * - `projection.ts`   DSH 会话事件日志 → 消息视图 → 旧协议消息
 *
 * 本类只保留：HTTP 服务器生命周期、路由分发、prompt 触发（onPrompt 回调）、
 * 删除会话编排，以及路由模块依赖的服务方法（RouterContext 实现）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ModelSelection } from "@deepseek-ai/dsh-agent";
import { legacyModelFromV2, type LegacyModel, type ModelRef } from "./oc-proto.js";
import { SessionStore, ocIdFromDsh, projectIdOf } from "./session-store.js";
import { DshEventMapper } from "./event-mapper.js";
import { readBody, sendJson } from "./http-util.js";
import { ocLog } from "./logging.js";
import { type SessionState } from "./types.js";
import { handleApi } from "./routes/api.js";
import { handleLegacyMisc, handleLegacySession } from "./routes/legacy.js";
import type { RouterContext } from "./routes/context.js";

// ── 配置 ───────────────────────────────────────────────────────────────────

export interface OcServerOptions {
  directory: string;
  /** 监听端口（默认 0 = 随机） */
  port?: number;
  /** 由 plugin 提供：创建/恢复 agent 并发送消息；返回 DSH session id 供绑定。
   *  hooks.onSession 必须在 send 之前同步调用（避免 turn/start 事件早于绑定而丢失）。 */
  onPrompt: (
    text: string,
    opts: { resumeSessionId?: string; preset?: string; model?: ModelRef },
    hooks: { onSession: (dshSessionId: string) => void },
  ) => Promise<string | undefined>;
  /** 获取当前模型选择（provider/model） */
  getSelection: () => ModelSelection | undefined;
  /** 列出某 provider 可用的全部模型（模型选择窗口的数据源） */
  listModels?: (provider: string) => Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number }>>;
  /** 查询 DSH 会话投影（启动时重建历史） */
  listDshSessions?: () => Promise<
    Array<{
      sessionId: string;
      title: string;
      preset?: string;
      createdAt: number;
      views: import("./projection.js").MessageView[];
      todos: Array<{ id: string; content: string; status: string; priority: string }>;
      diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }>;
    }>
  >;
  /** 删除 DSH 会话（释放活跃 agent + 删除持久化数据）。由 plugin 提供。 */
  onDeleteSession?: (dshSessionId: string) => Promise<void>;
}

// ── server ─────────────────────────────────────────────────────────────────

export class OcServer implements RouterContext {
  readonly store: SessionStore;
  readonly events: DshEventMapper;
  readonly directory: string;

  private ctx: Context;
  private opts: OcServerOptions;
  private http: ReturnType<typeof createServer>;
  private port = 0;

  constructor(ctx: Context, opts: OcServerOptions) {
    this.ctx = ctx;
    this.opts = opts;
    this.directory = opts.directory;
    this.store = new SessionStore(ctx, {
      directory: opts.directory,
      getSelection: opts.getSelection,
      listModels: opts.listModels,
      listDshSessions: opts.listDshSessions,
    });
    this.events = new DshEventMapper(this.store);
    this.http = createServer((req, res) => void this.handle(req, res).catch(() => sendJson(res, 500, { _tag: "UnknownError", message: "internal error" })));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.http.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
    const addr = this.http.address();
    this.port = typeof addr === "object" && addr ? addr.port : 0;
    ocLog(`[oc-server] listening on ${this.url}`);
    // 预热模型缓存 + 从 DSH 持久层重建历史会话（异步，不阻塞 TUI 启动）
    this.store.init();
    return this.port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // ── 供 plugin 调用的外部接口 ────────────────────────────────────────────

  /** DSH 事件 → opencode 事件（由 plugin 在 ctx.on('session/event') 调用）。 */
  handleDshEvent(session: { id: string; title?: string }, event: SessionEvent): void {
    this.events.handleDshEvent(session, event);
  }

  /** DSH approval/request → TUI permission 对话框（由 plugin 的审批钩子调用）。 */
  handleApproval(dshSessionId: string, request: { toolName: string; callId?: string; reason?: string }) {
    return this.events.handleApproval(dshSessionId, request);
  }

  /** DSH user question → TUI question 对话框（由 plugin 的提问 provider 调用）。 */
  handleQuestion(dshSessionId: string, items: Parameters<DshEventMapper["handleQuestion"]>[1]) {
    return this.events.handleQuestion(dshSessionId, items);
  }

  getSessionIdByDsh(dshSessionId: string): string | undefined {
    return this.store.findByDsh(dshSessionId)?.id;
  }

  // ── RouterContext 实现（路由模块依赖的服务方法）─────────────────────────

  projectId(directory: string): string {
    return projectIdOf(directory);
  }

  /** 旧协议 Provider（/config/providers、/provider、/api/provider、/api/model） */
  async legacyProvider(): Promise<{
    id: string;
    name: string;
    source: string;
    env: string[];
    options: Record<string, unknown>;
    models: Record<string, LegacyModel>;
  } | undefined> {
    const sel = this.store.selection();
    if (!sel) return undefined;
    // provider 的全部模型（模型选择窗口数据源）；无目录时回退当前模型
    const catalog = await this.store.listModels(sel.providerID);
    const models: Record<string, LegacyModel> = {};
    if (catalog.length > 0) {
      for (const m of catalog) {
        models[m.id] = legacyModelFromV2(
          { id: m.id, providerID: sel.providerID, name: m.name || m.id },
          m.contextWindow ?? this.store.modelContext,
        );
      }
    } else {
      models[sel.id] = legacyModelFromV2({ id: sel.id, providerID: sel.providerID, name: sel.id }, this.store.modelContext);
    }
    return {
      id: sel.providerID,
      name: sel.providerID,
      source: "config",
      env: [],
      options: {},
      models,
    };
  }

  /** 旧协议 Session（/session 列表） */
  legacySession(state: SessionState): Record<string, unknown> {
    const last = state.messages.at(-1);
    const lastTime = last?.info.time.updated ?? state.updatedAt;
    return {
      id: state.id,
      projectID: projectIdOf(state.directory),
      directory: state.directory,
      title: state.title,
      version: "1",
      time: { created: state.createdAt, updated: state.updatedAt, lastMessage: lastTime },
    };
  }

  sessionOr404(state: SessionState | undefined, res: ServerResponse): state is SessionState {
    if (state) return true;
    sendJson(res, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
    return false;
  }

  /** 消息请求的模型切换：payload.model → 会话当前模型。 */
  applyRequestModel(state: SessionState, payload: Record<string, unknown>): void {
    const reqModel = payload.model as { providerID?: string; modelID?: string } | undefined;
    if (reqModel?.providerID && reqModel.modelID) {
      state.currentModel = { providerID: reqModel.providerID, id: reqModel.modelID };
    }
  }

  /** 触发 DSH agent（preset/model 随消息传递）并绑定会话、通知变更。 */
  runPrompt(state: SessionState, text: string, opts: { preset?: string }): void {
    void this.opts
      .onPrompt(
        text,
        {
          resumeSessionId: state.dshSessionId,
          preset: opts.preset,
          model: state.currentModel,
        },
        { onSession: (dshId) => this.bindDshSession(state.id, dshId) },
      )
      .then((dshId) => {
        if (dshId) this.bindDshSession(state.id, dshId);
      });
    this.store.touchSession(state);
  }

  /** 触发 DSH agent（不通知会话变更；prompt_async 用）。返回 DSH session id。 */
  sendPrompt(text: string, opts: { resumeSessionId?: string }): Promise<string | undefined> {
    return this.opts.onPrompt(
      text,
      { resumeSessionId: opts.resumeSessionId },
      { onSession: () => undefined },
    );
  }

  bindDshSession(ocSessionId: string, dshSessionId: string): void {
    const state = this.store.sessions.get(ocSessionId);
    if (state) {
      state.dshSessionId = dshSessionId;
      state.updatedAt = Date.now();
    }
  }

  /**
   * 删除会话（DELETE /session/:id）：先删 DSH 侧数据（可能抛错），
   * 成功后移除内存状态并通知 TUI。
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const state = this.store.sessions.get(sessionId);
    if (!state) return true; // 已不存在视为成功
    if (state.dshSessionId && this.opts.onDeleteSession) {
      try {
        await this.opts.onDeleteSession(state.dshSessionId);
      } catch (error) {
        ocLog(`[oc-server] delete session ${sessionId} dsh side failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }
    return this.store.removeSession(sessionId);
  }

  /**
   * 查询 DSH 会话列表（直查 sessionQuery，以 DSH 为权威数据源）。
   * 合并兼容层状态（含消息/tokens/agents），解决"读自己的而不是 DSH 的"。
   */
  async listSessions(scope?: string | null): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    try {
      // 直查持久层 listSnapshots（而非 sessionQuery.listSessions），
      // 后者依赖 corpus 索引/懒加载，在插件进程内可能返回空。
      const snapshots = await this.ctx.sessionPersistence.listSnapshots();
      ocLog(`[oc-server] listSessions: ${snapshots.length} snapshots from persistence, my directory=${this.directory}`);
      for (const snapshot of snapshots) {
        const header = snapshot.header;
        // 按工作目录过滤（对齐 dsh-web 的项目视图）
        if (header.cwd && this.directory && header.cwd !== this.directory) continue;
        const ocId = ocIdFromDsh(header.id);
        // 兼容层已删除的会话（DSH 侧删除可能延迟同步），从列表过滤
        if (this.store.isDeleted(ocId)) continue;
        let state = [...this.store.sessions.values()].find((s) => s.dshSessionId === header.id);
        if (state) {
          out.push(this.legacySession(state));
        } else {
          // DSH 有但兼容层未 hydrate：创建占位状态并同步。
          state = this.store.getOrCreateSession(ocId, header.cwd ?? this.directory);
          state.dshSessionId = header.id;
          state.createdAt = header.createdAt;
          state.updatedAt = header.createdAt;
          this.store.touchSession(state);
          out.push(this.legacySession(state));
        }
      }
    } catch (error) {
      ocLog(`[oc-server] listSessions failed: ${error instanceof Error ? error.message : String(error)}`);
      // 失败回退到兼容层内存
      for (const state of this.store.sessions.values()) {
        if (scope === "project" && state.directory !== this.directory) continue;
        if (this.store.isDeleted(state.id)) continue;
        out.push(this.legacySession(state));
      }
    }
    return out;
  }

  // ── HTTP 入口与路由分发 ─────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (process.env.DSH_OC_DEBUG === "1") ocLog(`[oc-server] ${method} ${path}`);

    // 读取 body
    const body = await readBody(req);

    // ── v2 端点 ──
    if (await handleApi(this, path, method, body, url, req, res)) return;
    // 旧 /session/:id/* 子路由
    if (await handleLegacySession(this, path, method, body, url, req, res)) return;
    // 杂项旧路径
    if (await handleLegacyMisc(this, path, method, body, url, req, res)) return;

    // 未实现 → opencode 错误格式
    sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
  }
}
