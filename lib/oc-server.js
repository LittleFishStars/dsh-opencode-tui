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
import { createServer } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { legacyModelFromV2 } from "./oc-proto.js";
import { SessionStore, ocIdFromDsh, projectIdOf } from "./session-store.js";
import { DshEventMapper } from "./event-mapper.js";
import { readBody, sendJson } from "./http-util.js";
import { ocLog } from "./logging.js";
import { handleApi } from "./routes/api.js";
import { handleLegacyMisc, handleLegacySession } from "./routes/legacy.js";
// ── 文件系统扫描 ──────────────────────────────────────────────────────
/** 递归查找目录下的所有 session.jsonl.zstd（DSH 会话持久化文件）。 */
async function walkSessions(dir, depth = 3) {
    if (depth <= 0)
        return [];
    const out = [];
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walkSessions(full, depth - 1)));
        }
        else if (entry.name === "session.jsonl.zstd" || entry.name === "session.jsonl") {
            out.push(full);
        }
    }
    return out;
}
// ── server ─────────────────────────────────────────────────────────────────
/** 将 cwd 编码为 DSH 会话目录名格式：/home/ylxc/Projects/DSH → --home-ylxc-Projects-DSH-- */
function encodeCwdSlug(cwd) {
    return "-" + cwd.replace(/\//g, "-") + "--";
}
export class OcServer {
    store;
    events;
    directory;
    ctx;
    opts;
    http;
    port = 0;
    constructor(ctx, opts) {
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
    async start() {
        await new Promise((resolve) => this.http.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
        const addr = this.http.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        ocLog(`[oc-server] listening on ${this.url}`);
        // 预热模型缓存 + 从 DSH 持久层重建历史会话（异步，不阻塞 TUI 启动）
        this.store.init();
        return this.port;
    }
    get url() {
        return `http://127.0.0.1:${this.port}`;
    }
    async stop() {
        await new Promise((resolve) => this.http.close(() => resolve()));
    }
    // ── 供 plugin 调用的外部接口 ────────────────────────────────────────────
    /** DSH 事件 → opencode 事件（由 plugin 在 ctx.on('session/event') 调用）。 */
    handleDshEvent(session, event) {
        this.events.handleDshEvent(session, event);
    }
    /** DSH approval/request → TUI permission 对话框（由 plugin 的审批钩子调用）。 */
    handleApproval(dshSessionId, request) {
        return this.events.handleApproval(dshSessionId, request);
    }
    /** DSH user question → TUI question 对话框（由 plugin 的提问 provider 调用）。 */
    handleQuestion(dshSessionId, items) {
        return this.events.handleQuestion(dshSessionId, items);
    }
    getSessionIdByDsh(dshSessionId) {
        return this.store.findByDsh(dshSessionId)?.id;
    }
    // ── RouterContext 实现（路由模块依赖的服务方法）─────────────────────────
    projectId(directory) {
        return projectIdOf(directory);
    }
    /** 旧协议 Provider（/config/providers、/provider、/api/provider、/api/model） */
    async legacyProvider() {
        const sel = this.store.selection();
        if (!sel)
            return undefined;
        // provider 的全部模型（模型选择窗口数据源）；无目录时回退当前模型
        const catalog = await this.store.listModels(sel.providerID);
        const models = {};
        if (catalog.length > 0) {
            for (const m of catalog) {
                models[m.id] = legacyModelFromV2({ id: m.id, providerID: sel.providerID, name: m.name || m.id }, m.contextWindow ?? this.store.modelContext);
            }
        }
        else {
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
    legacySession(state) {
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
    sessionOr404(state, res) {
        if (state)
            return true;
        sendJson(res, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
        return false;
    }
    /** 消息请求的模型切换：payload.model → 会话当前模型。 */
    applyRequestModel(state, payload) {
        const reqModel = payload.model;
        if (reqModel?.providerID && reqModel.modelID) {
            state.currentModel = { providerID: reqModel.providerID, id: reqModel.modelID };
        }
    }
    /** 触发 DSH agent（preset/model 随消息传递）并绑定会话、通知变更。 */
    runPrompt(state, text, opts) {
        void this.opts
            .onPrompt(text, {
            resumeSessionId: state.dshSessionId,
            preset: opts.preset,
            model: state.currentModel,
        }, { onSession: (dshId) => this.bindDshSession(state.id, dshId) })
            .then((dshId) => {
            if (dshId)
                this.bindDshSession(state.id, dshId);
        });
        this.store.touchSession(state);
    }
    /** 触发 DSH agent（不通知会话变更；prompt_async 用）。返回 DSH session id。 */
    sendPrompt(text, opts) {
        return this.opts.onPrompt(text, { resumeSessionId: opts.resumeSessionId }, { onSession: () => undefined });
    }
    bindDshSession(ocSessionId, dshSessionId) {
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
    async deleteSession(sessionId) {
        const state = this.store.sessions.get(sessionId);
        if (!state)
            return true; // 已不存在视为成功
        if (state.dshSessionId && this.opts.onDeleteSession) {
            try {
                await this.opts.onDeleteSession(state.dshSessionId);
            }
            catch (error) {
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
    async listSessions(scope) {
        const out = [];
        try {
            // DSH persistence.list/listSnapshots 在插件进程内返回 0（跨进程不同步），
            // 改为直读 ~/.dsh/sessions/ 文件系统，从目录名解析 session id 与 cwd。
            // 扫描 DSH 会话存储根：优先 DSH_OPENCODE_SESSION_ROOT（DSH agent 实际存储位置），否则回退到 DSH_HOME/sessions 或 ~/.dsh/sessions
            const ocRoot = process.env.DSH_OPENCODE_SESSION_ROOT;
            const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
            const sessionsRoot = ocRoot ? ocRoot : join(dshHome, "sessions");
            const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink())
                    continue;
                // 按 cwd 目录名匹配（对齐 dsh-web 的项目视图）
                if (entry.name !== encodeCwdSlug(this.directory))
                    continue;
                const cwdDir = join(sessionsRoot, entry.name);
                const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
                for (const sd of sessionDirs) {
                    if (!sd.isDirectory())
                        continue;
                    // 会话目录名：session-<uuid> → id = uuid
                    const match = sd.name.match(/^session-(.+)$/);
                    if (!match || !match[1])
                        continue;
                    const dshId = match[1];
                    const ocId = ocIdFromDsh(dshId);
                    if (this.store.isDeleted(ocId))
                        continue;
                    // 获取 createdAt（文件 mtime，精确到秒）
                    let createdAt = Date.now();
                    try {
                        const sessionFile = join(cwdDir, sd.name, "session.jsonl.zstd");
                        const st = await stat(sessionFile);
                        createdAt = st.mtimeMs;
                    }
                    catch { }
                    let state = [...this.store.sessions.values()].find((s) => s.dshSessionId === dshId);
                    if (state) {
                        out.push(this.legacySession(state));
                    }
                    else {
                        state = this.store.getOrCreateSession(ocId, this.directory);
                        state.dshSessionId = dshId;
                        state.createdAt = createdAt;
                        state.updatedAt = createdAt;
                        this.store.touchSession(state);
                        out.push(this.legacySession(state));
                    }
                }
            }
        }
        catch (error) {
            ocLog(`[oc-server] listSessions failed: ${error instanceof Error ? error.message : String(error)}`);
            for (const state of this.store.sessions.values()) {
                if (scope === "project" && state.directory !== this.directory)
                    continue;
                if (this.store.isDeleted(state.id))
                    continue;
                out.push(this.legacySession(state));
            }
        }
        return out;
    }
    // ── HTTP 入口与路由分发 ─────────────────────────────────────────────────
    async handle(req, res) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const path = url.pathname;
        const method = req.method ?? "GET";
        if (process.env.DSH_OC_DEBUG === "1")
            ocLog(`[oc-server] ${method} ${path}`);
        // 读取 body
        const body = await readBody(req);
        // ── v2 端点 ──
        if (await handleApi(this, path, method, body, url, req, res))
            return;
        // 旧 /session/:id/* 子路由
        if (await handleLegacySession(this, path, method, body, url, req, res))
            return;
        // 杂项旧路径
        if (await handleLegacyMisc(this, path, method, body, url, req, res))
            return;
        // 未实现 → opencode 错误格式
        sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
    }
}
//# sourceMappingURL=oc-server.js.map