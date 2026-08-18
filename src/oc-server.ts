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
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionHeader as DshSessionHeader } from "@deepseek-ai/dsh-session";
import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import type { ModelSelection } from "@deepseek-ai/dsh-agent";
import { legacyModelFromV2, type LegacyModel, type ModelRef } from "./oc-proto.js";
import { SessionStore, ocIdFromDsh, projectIdOf } from "./session-store.js";
import { DshEventMapper } from "./event-mapper.js";
import { readBody, sendJson } from "./http-util.js";
import { ocLog } from "./logging.js";
import { type SessionState } from "./types.js";
import { handleApi } from "./routes/api.js";
import { projectEvents, foldSessionMeta, todosFromEvents, diffsFromEvents } from "./projection.js";
import { handleLegacyMisc, handleLegacySession } from "./routes/legacy.js";
import type { RouterContext } from "./routes/context.js";

// ── 文件系统扫描 ──────────────────────────────────────────────────────

/** 递归查找目录下的所有 session.jsonl.zstd（DSH 会话持久化文件）。 */
async function walkSessions(dir: string, depth = 3): Promise<string[]> {
  if (depth <= 0) return [];
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkSessions(full, depth - 1)));
    } else if (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl") {
      out.push(full);
    }
  }
  return out;
}

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

/** 将 cwd 编码为 DSH 会话目录名格式：/home/ylxc/Projects/DSH → --home-ylxc-Projects-DSH-- */
function encodeCwdSlug(cwd: string): string {
  return "-" + cwd.replace(/\//g, "-") + "--";
}

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
    ocLog(`[oc-server] deleteSession ${sessionId}: dshSessionId=${state.dshSessionId ?? "UNDEF"}, hasOnDelete=${!!this.opts.onDeleteSession}`);
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
    // 主进程运行：sessionQuery.listSessions() 可用，直接读权威会话列表。
    // （隔离测试环境返回 0 是因为没有会话，不是跨进程问题）
    const sessionQuery = this.ctx.get("sessionQuery") as {
      listSessions(signal?: AbortSignal): Promise<Array<{ header: { id: string; cwd?: string; createdAt: number; parentSession?: string; origin?: string } }>>;
      readTitleSnapshots(ids: readonly string[]): Promise<Array<{ sessionId: string; status: "fulfilled" | "rejected"; value?: { title?: { title?: string; text?: string } } }>>;
    } | undefined;
    if (sessionQuery) {
      try {
        const records = await sessionQuery.listSessions();
        ocLog(`[oc-server] DIAG listSessions: sessionQuery returned ${records.length} records, directory=${this.directory}`);
        if (records.length > 0) {
          // 按 cwd 过滤
          const matched = records.filter((r) => !r.header.cwd || !this.directory || r.header.cwd === this.directory);
          ocLog(`[oc-server] DIAG listSessions: matched ${matched.length} by cwd`);
          // 批量读标题（同 dsh-tui 的 readTitleSnapshots）
          let titles = new Map<string, string>();
          try {
            const observations = await sessionQuery.readTitleSnapshots(matched.map((r) => r.header.id));
            ocLog(`[oc-server] DIAG listSessions: readTitleSnapshots returned ${observations.length} observations`);
            titles = new Map(
              observations
                .filter((o) => o.status === "fulfilled")
                .map((o) => [o.sessionId, o.value?.title?.title ?? o.value?.title?.text ?? ""]),
            );
          } catch (error) {
            ocLog(`[oc-server] readTitleSnapshots failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          const out: Array<Record<string, unknown>> = [];
          for (const record of matched) {
            const header = record.header;
            const dshId = header.id;
            const ocId = ocIdFromDsh(dshId);
            if (this.store.isDeleted(ocId)) continue;
            const existing = [...this.store.sessions.values()].find((s) => s.dshSessionId === dshId);
            if (existing) {
              out.push(this.legacySession(existing));
            } else {
              // 轻量创建（不 hydrate，用户进入会话时按需加载）
              const state = this.store.getOrCreateSession(ocId, this.directory);
              state.dshSessionId = dshId;
              state.title = titles.get(dshId) ?? "";
              state.createdAt = header.createdAt;
              state.updatedAt = header.createdAt;
              out.push(this.legacySession(state));
            }
          }
          ocLog(`[oc-server] DIAG listSessions: returning ${out.length} sessions via sessionQuery`);
          return out;
        }
      } catch (error) {
        ocLog(`[oc-server] listSessions sessionQuery failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    ocLog(`[oc-server] DIAG listSessions: falling back to filesystem scan`);
    const fsResult = await this.fallbackFilesystemScan(scope);
    ocLog(`[oc-server] DIAG listSessions: filesystem scan returned ${fsResult.length}`);
    return fsResult;
  }

  /** 回退：扫描文件系统获取会话列表（能找到全部会话，含两种目录格式）。 */
  private async fallbackFilesystemScan(scope?: string | null): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    try {
      const sessionsRoot = process.env.DSH_OPENCODE_SESSION_ROOT
        ? process.env.DSH_OPENCODE_SESSION_ROOT
        : join(process.env.DSH_HOME ?? homedir(), ".dsh", "sessions");
      ocLog(`[oc-server] DIAG fallback: sessionsRoot=${sessionsRoot}, DSH_HOME=${process.env.DSH_HOME ?? "UNSET"}, OC_ROOT=${process.env.DSH_OPENCODE_SESSION_ROOT ?? "UNSET"}, homedir=${homedir()}, cwd=${process.cwd()}`);
      const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name !== encodeCwdSlug(this.directory)) continue;
        const cwdDir = join(sessionsRoot, entry.name);
        const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
        for (const sd of sessionDirs) {
          if (!sd.isDirectory()) continue;
          // 会话目录名两种格式：session-<uuid> 或直接 <uuid>
          const match = sd.name.match(/^session-(.+)$/) ?? sd.name.match(/^([0-9a-fA-F-]{36})$/);
          if (!match || !match[1]) continue;
          const dshId = match[1];
          const ocId = ocIdFromDsh(dshId);
          if (this.store.isDeleted(ocId)) continue;
          const sessionFile = join(cwdDir, sd.name, "session.jsonl.zstd");
          let createdAt = Date.now();
          try {
            const st = await stat(sessionFile);
            createdAt = st.mtimeMs;
          } catch {}
          const existing = [...this.store.sessions.values()].find((s) => s.dshSessionId === dshId);
          if (existing) {
            // 已有会话（已 hydrate）：直接用完整状态
            out.push(this.legacySession(existing));
          } else {
            // 未 hydrate：轻量提取标题，不加载全部消息（大会话 4-5 万事件，全量 hydrate 太慢）
            const title = await this.extractSessionTitle(sessionFile);
            const state = this.store.getOrCreateSession(ocId, this.directory);
            state.dshSessionId = dshId;
            state.title = title;
            state.createdAt = createdAt;
            state.updatedAt = createdAt;
            out.push(this.legacySession(state));
          }
        }
      }
    } catch (error) {
      ocLog(`[oc-server] fallbackFilesystemScan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return out;
  }

  /** 轻量提取会话标题：解压文件，找 session/title 事件或首条 user 消息。不投影全部消息。 */
  private async extractSessionTitle(sessionFile: string): Promise<string> {
    try {
      const st = await stat(sessionFile).catch(() => null);
      if (!st) return "";
      const { execFile } = await import("node:child_process");
      const raw = await new Promise<string>((resolve, reject) => {
        execFile("zstd", ["-d", "-c", sessionFile], { maxBuffer: 512 * 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      // 找最后一个 session/title 事件
      let title = "";
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { type?: string; data?: { title?: string; content?: Array<{ type?: string; text?: string }> } };
          if (e.type === "session/title" && e.data?.title && e.data.title.trim() !== "") {
            title = e.data.title;
          }
        } catch {}
      }
      if (title) return title;
      // 兜底：首条 user 消息文本
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { type?: string; data?: { inserted?: Array<{ content?: Array<{ type?: string; text?: string }> }> } };
          if (e.type === "agent/inbox/spliced") {
            for (const item of e.data?.inserted ?? []) {
              for (const c of item.content ?? []) {
                if (c.type === "text" && c.text && c.text.trim()) {
                  const t = c.text.replace(/\s+/g, " ").trim();
                  return t.length > 60 ? t.slice(0, 57) + "..." : t;
                }
              }
            }
          }
        } catch {}
      }
      return "";
    } catch {
      return "";
    }
  }

  /** 通过 sessionPersistence.inspect 加载事件并 hydrate 到兼容层。 */
  private async hydrateFromFilesystem(dshId: string, createdAt: number, cwdDir: string, sessionDirName: string, out: Array<Record<string, unknown>>): Promise<void> {
    try {
      const sessionFile = join(cwdDir, sessionDirName, "session.jsonl.zstd");
      const st = await stat(sessionFile).catch(() => null);
      if (!st) return;
      // 大会话解压后可能超过 100MB，用异步 execFile + 512MB maxBuffer
      const { execFile } = await import("node:child_process");
      const raw = await new Promise<string>((resolve, reject) => {
        execFile("zstd", ["-d", "-c", sessionFile], { maxBuffer: 512 * 1024 * 1024 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });
      const events: SessionEvent[] = [];
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line) as SessionEvent); } catch {}
      }
      if (events.length === 0) return;
      const views = projectEvents(events);
      const folded = foldSessionMeta(dshId, createdAt, events);
      const todos = todosFromEvents(events);
      const diffs = diffsFromEvents(events);
      this.store.hydrateSession(dshId, folded.title, folded.preset, views, todos, diffs, folded.createdAt);
      const state = [...this.store.sessions.values()].find((s) => s.dshSessionId === dshId);
      if (state) {
        out.push(this.legacySession(state));
      }
    } catch (error) {
      ocLog(`[oc-server] hydrateFromFilesystem ${dshId.slice(0,12)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  /**
   * 按需 hydrate：用户进入会话时从文件系统加载完整消息。
   * 轻量列表会话只有元信息（快），这里补全消息内容。
   */
  async hydrateSessionOnDemand(state: import("./types.js").SessionState): Promise<void> {
    if (state.messages.length > 0 || !state.dshSessionId) return;
    try {
      const sessionsRoot = process.env.DSH_OPENCODE_SESSION_ROOT
        ? process.env.DSH_OPENCODE_SESSION_ROOT
        : join(process.env.DSH_HOME ?? homedir(), ".dsh", "sessions");
      const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name !== encodeCwdSlug(this.directory)) continue;
        const cwdDir = join(sessionsRoot, entry.name);
        const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
        for (const sd of sessionDirs) {
          if (!sd.isDirectory()) continue;
          const match = sd.name.match(/^session-(.+)$/) ?? sd.name.match(/^([0-9a-fA-F-]{36})$/);
          if (!match || !match[1] || match[1] !== state.dshSessionId) continue;
          await this.hydrateFromFilesystem(state.dshSessionId, state.createdAt, cwdDir, sd.name, []);
          return;
        }
      }
    } catch (error) {
      ocLog(`[oc-server] hydrateSessionOnDemand ${state.dshSessionId?.slice(0,12)} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
