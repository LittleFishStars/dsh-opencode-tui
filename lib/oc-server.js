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
import { SessionTitleCache } from "./title-cache.js";
import { handleApi } from "./routes/api.js";
import { projectEvents, foldSessionMeta, todosFromEvents, diffsFromEvents } from "./projection.js";
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
    titleCache = new SessionTitleCache();
    port = 0;
    /** 当前目录活跃的 DSH 会话 id：无 resumeSessionId 时复用，避免每条消息创建新会话 */
    currentDshSessionId;
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
        this.events = new DshEventMapper(this.store, {
            titleCache: { set: (id, title, mtime) => this.titleCache.set(id, title, mtime) },
        });
        this.http = createServer((req, res) => void this.handle(req, res).catch(() => sendJson(res, 500, { _tag: "UnknownError", message: "internal error" })));
    }
    async start() {
        await new Promise((resolve) => this.http.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
        const addr = this.http.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        ocLog(`[oc-server] listening on ${this.url}`);
        // 预热模型缓存 + 从 DSH 持久层重建历史会话（异步，不阻塞 TUI 启动）
        this.store.init();
        // 启动时加载会话标题缓存 + 后台解压提取新会话标题
        this.titleCache.load();
        void this.loadSessionTitles();
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
        // 无 dshSessionId 时复用当前目录的活跃会话，避免每条消息创建新会话
        const resumeId = state.dshSessionId ?? this.currentDshSessionId;
        void this.opts
            .onPrompt(text, {
            resumeSessionId: resumeId,
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
        // 更新当前目录活跃会话，后续消息复用
        this.currentDshSessionId = dshSessionId;
    }
    /**
     * 删除会话（DELETE /session/:id）：先删 DSH 侧数据（可能抛错），
     * 成功后移除内存状态并通知 TUI。
     */
    async deleteSession(sessionId) {
        const state = this.store.sessions.get(sessionId);
        if (!state)
            return true; // 已不存在视为成功
        ocLog(`[oc-server] deleteSession ${sessionId}: dshSessionId=${state.dshSessionId ?? "UNDEF"}, hasOnDelete=${!!this.opts.onDeleteSession}`);
        if (state.dshSessionId && this.opts.onDeleteSession) {
            try {
                await this.opts.onDeleteSession(state.dshSessionId);
            }
            catch (error) {
                ocLog(`[oc-server] delete session ${sessionId} dsh side failed: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        }
        // 删除的是当前活跃会话时，清除追踪以便后续消息创建新会话
        if (state.dshSessionId === this.currentDshSessionId) {
            this.currentDshSessionId = undefined;
        }
        return this.store.removeSession(sessionId);
    }
    /**
     * 查询 DSH 会话列表（直查 sessionQuery，以 DSH 为权威数据源）。
     * 合并兼容层状态（含消息/tokens/agents），解决"读自己的而不是 DSH 的"。
     */
    async listSessions(scope) {
        // sessionQuery 在插件进程抛 "cannot get required service sessions in inactive context"，
        // readTitleSnapshots 同样不可用。直接使用文件系统扫描（可靠，返回全部会话）。
        return this.fallbackFilesystemScan(scope);
    }
    /** 回退：扫描文件系统获取会话列表（从标题缓存读取，毫秒级响应）。 */
    async fallbackFilesystemScan(scope) {
        const out = [];
        try {
            const sessionsRoot = process.env.DSH_OPENCODE_SESSION_ROOT
                ? process.env.DSH_OPENCODE_SESSION_ROOT
                : join(process.env.DSH_HOME ?? homedir(), ".dsh", "sessions");
            ocLog(`[oc-server] hydrateOnDemand: root=${sessionsRoot} slug=${encodeCwdSlug(this.directory)}`);
            const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
            // 收集候选会话（含 mtime 用于排序/过滤）
            const candidates = [];
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink())
                    continue;
                if (entry.name !== encodeCwdSlug(this.directory))
                    continue;
                const cwdDir = join(sessionsRoot, entry.name);
                const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
                for (const sd of sessionDirs) {
                    if (!sd.isDirectory())
                        continue;
                    // 会话目录名两种格式：session-<uuid> 或直接 <uuid>
                    const match = sd.name.match(/^session-(.+)$/) ?? sd.name.match(/^([0-9a-fA-F-]{36})$/);
                    if (!match || !match[1])
                        continue;
                    const dshId = match[1];
                    const ocId = ocIdFromDsh(dshId);
                    if (this.store.isDeleted(ocId))
                        continue;
                    const sessionFile = join(cwdDir, sd.name, "session.jsonl.zstd");
                    let createdAt = Date.now();
                    try {
                        const st = await stat(sessionFile);
                        createdAt = st.mtimeMs;
                    }
                    catch { }
                    // 收集候选会话（含 mtime 用于排序/过滤）
                    candidates.push({ dshId, ocId, createdAt });
                }
            }
            // 过滤：有活跃会话只显示活跃会话；否则只显示最近 5 个（对齐 web 界面）
            const currentId = this.currentDshSessionId?.startsWith("session-") ? this.currentDshSessionId.slice(8) : this.currentDshSessionId;
            let filtered = candidates;
            if (currentId) {
                filtered = candidates.filter((c) => c.dshId === currentId);
            }
            else {
                filtered = candidates.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
            }
            for (const c of filtered) {
                // 查找已有会话：兼容旧格式（session-<uuid>）和新格式（uuid）
                const existing = [...this.store.sessions.values()].find((s) => s.dshSessionId === c.dshId || s.dshSessionId === `session-${c.dshId}`);
                if (existing) {
                    // 归一化旧会话的 dshSessionId（剥离 session- 前缀）
                    if (existing.dshSessionId?.startsWith("session-"))
                        existing.dshSessionId = existing.dshSessionId.slice(8);
                    out.push(this.legacySession(existing));
                }
                else {
                    const state = this.store.getOrCreateSession(c.ocId, this.directory);
                    state.dshSessionId = c.dshId;
                    // 从缓存读取标题（启动时已后台加载）；缓存未命中则为空
                    const cachedTitle = this.titleCache.get(c.dshId, c.createdAt);
                    if (cachedTitle === undefined) {
                        ocLog(`[oc-server] DIAG title cache MISS: dshId=${c.dshId.slice(0, 8)} mtime=${c.createdAt} cacheKeys=${this.titleCache.keys().length}`);
                    }
                    state.title = cachedTitle ?? "";
                    state.createdAt = c.createdAt;
                    state.updatedAt = c.createdAt;
                    out.push(this.legacySession(state));
                }
            }
        }
        catch (error) {
            ocLog(`[oc-server] fallbackFilesystemScan failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return out;
    }
    /** 启动时后台加载会话标题：扫描文件系统，对缓存未命中的会话解压提取标题。 */
    async loadSessionTitles() {
        try {
            const sessionsRoot = process.env.DSH_OPENCODE_SESSION_ROOT
                ? process.env.DSH_OPENCODE_SESSION_ROOT
                : join(process.env.DSH_HOME ?? homedir(), ".dsh", "sessions");
            const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
            const pending = [];
            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink())
                    continue;
                if (entry.name !== encodeCwdSlug(this.directory))
                    continue;
                const cwdDir = join(sessionsRoot, entry.name);
                const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
                for (const sd of sessionDirs) {
                    if (!sd.isDirectory())
                        continue;
                    const match = sd.name.match(/^session-(.+)$/) ?? sd.name.match(/^([0-9a-fA-F-]{36})$/);
                    if (!match || !match[1])
                        continue;
                    const dshId = match[1];
                    const sessionFile = join(cwdDir, sd.name, "session.jsonl.zstd");
                    let mtime = Date.now();
                    try {
                        const st = await stat(sessionFile);
                        mtime = st.mtimeMs;
                    }
                    catch {
                        continue;
                    }
                    // 缓存命中且 mtime 未变则跳过
                    if (this.titleCache.get(dshId, mtime) !== undefined)
                        continue;
                    pending.push({ dshId, file: sessionFile, mtime });
                }
            }
            if (pending.length === 0)
                return;
            ocLog(`[oc-server] loading titles for ${pending.length} uncached sessions...`);
            // 并行提取（并发 4）
            const concurrency = 4;
            let index = 0;
            const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
                while (index < pending.length) {
                    const s = pending[index++];
                    const title = await this.extractSessionTitle(s.file);
                    this.titleCache.set(s.dshId, title, s.mtime);
                }
            });
            await Promise.all(workers);
            this.titleCache.save();
            ocLog(`[oc-server] title cache saved (${this.titleCache.keys().length} entries, ${pending.length} extracted)`);
        }
        catch (error) {
            ocLog(`[oc-server] loadSessionTitles failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** 轻量提取会话标题：解压文件，找 session/title 事件或首条 user 消息。不投影全部消息。 */
    async extractSessionTitle(sessionFile) {
        try {
            const st = await stat(sessionFile).catch(() => null);
            if (!st)
                return "";
            const { execFile } = await import("node:child_process");
            const raw = await new Promise((resolve, reject) => {
                execFile("zstd", ["-d", "-c", sessionFile], { maxBuffer: 512 * 1024 * 1024 }, (err, stdout) => {
                    if (err)
                        reject(err);
                    else
                        resolve(stdout);
                });
            });
            // 找最后一个 session/title 事件
            let title = "";
            for (const line of raw.split("\n")) {
                if (!line.trim())
                    continue;
                try {
                    const e = JSON.parse(line);
                    if (e.type === "session/title" && e.data?.title && e.data.title.trim() !== "") {
                        title = e.data.title;
                    }
                }
                catch { }
            }
            if (title)
                return title;
            // 兜底：首条 user 消息文本
            for (const line of raw.split("\n")) {
                if (!line.trim())
                    continue;
                try {
                    const e = JSON.parse(line);
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
                }
                catch { }
            }
            return "";
        }
        catch {
            return "";
        }
    }
    /** 通过 sessionPersistence.inspect 加载事件并 hydrate 到兼容层。 */
    async hydrateFromFilesystem(dshId, createdAt, cwdDir, sessionDirName, out) {
        try {
            const sessionFile = join(cwdDir, sessionDirName, "session.jsonl.zstd");
            const st = await stat(sessionFile).catch(() => null);
            if (!st)
                return;
            // 大会话解压后可能超过 100MB，用异步 execFile + 512MB maxBuffer
            const { execFile } = await import("node:child_process");
            const raw = await new Promise((resolve, reject) => {
                execFile("zstd", ["-d", "-c", sessionFile], { maxBuffer: 512 * 1024 * 1024 }, (err, stdout) => {
                    if (err)
                        reject(err);
                    else
                        resolve(stdout);
                });
            });
            const events = [];
            for (const line of raw.split("\n")) {
                if (!line.trim())
                    continue;
                try {
                    events.push(JSON.parse(line));
                }
                catch { }
            }
            if (events.length === 0) {
                ocLog(`[oc-server] hydrateFromFile: no events`);
                return;
            }
            const views = projectEvents(events);
            ocLog(`[oc-server] hydrateFromFile: ${events.length} events → ${views.length} views`);
            const folded = foldSessionMeta(dshId, createdAt, events);
            const todos = todosFromEvents(events);
            const diffs = diffsFromEvents(events);
            this.store.hydrateSession(dshId, folded.title, folded.preset, views, todos, diffs, folded.createdAt);
            const state = [...this.store.sessions.values()].find((s) => s.dshSessionId === dshId);
            if (state) {
                out.push(this.legacySession(state));
            }
        }
        catch (error) {
            ocLog(`[oc-server] hydrateFromFilesystem ${dshId.slice(0, 12)} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 按需 hydrate：用户进入会话时从文件系统加载完整消息。
     * 轻量列表会话只有元信息（快），这里补全消息内容。
     */
    async hydrateSessionOnDemand(state) {
        if (state.messages.length > 0 || !state.dshSessionId)
            return;
        // 归一化 dshSessionId：旧会话可能带 session- 前缀，文件系统目录名不带前缀
        const dshId = state.dshSessionId.startsWith('session-') ? state.dshSessionId.slice(8) : state.dshSessionId;
        ocLog(`[oc-server] hydrateOnDemand: ocId=${state.id?.slice(0, 12)} dshId=${dshId.slice(0, 12)} msgs=${state.messages.length}`);
        try {
            const sessionsRoot = process.env.DSH_OPENCODE_SESSION_ROOT
                ? process.env.DSH_OPENCODE_SESSION_ROOT
                : join(process.env.DSH_HOME ?? homedir(), ".dsh", "sessions");
            const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                if (entry.name !== encodeCwdSlug(this.directory))
                    continue;
                const cwdDir = join(sessionsRoot, entry.name);
                const sessionDirs = await readdir(cwdDir, { withFileTypes: true }).catch(() => []);
                for (const sd of sessionDirs) {
                    if (!sd.isDirectory())
                        continue;
                    const match = sd.name.match(/^session-(.+)$/) ?? sd.name.match(/^([0-9a-fA-F-]{36})$/);
                    if (!match || !match[1] || match[1] !== dshId)
                        continue;
                    ocLog(`[oc-server] hydrateOnDemand: found ${sd.name.slice(0, 20)}, hydrating...`);
                    await this.hydrateFromFilesystem(dshId, state.createdAt, cwdDir, sd.name, []);
                    const st = this.store.sessions.get(state.id);
                    ocLog(`[oc-server] hydrateOnDemand: done, msgs=${st?.messages.length ?? 0}`);
                    return;
                }
            }
            ocLog(`[oc-server] hydrateOnDemand: NO FILE FOUND for dshId=${dshId.slice(0, 12)}`);
        }
        catch (error) {
            ocLog(`[oc-server] hydrateOnDemand ${dshId.slice(0, 12)} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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