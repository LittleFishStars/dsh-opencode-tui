import { createHash } from "node:crypto";
import { makeSessionInfo } from "./oc-proto.js";
import { viewsToLegacyMessages } from "./projection.js";
import { agentOfPreset, DEFAULT_AGENT } from "./types.js";
import { ocLog } from "./logging.js";
/** DSH 会话 id → 稳定 opencode 会话 id（重启后保持一致）。 */
export function ocIdFromDsh(dshSessionId) {
    return "ses_" + createHash("sha1").update(dshSessionId).digest("hex").slice(0, 20);
}
export function projectIdOf(directory) {
    return createHash("sha1").update(directory).digest("hex");
}
export class SessionStore {
    sessions = new Map();
    globalSse = new Set();
    /** 已被兼容层删除的会话 id（DSH 侧删除可能延迟同步，需从列表过滤）。 */
    deleted = new Set();
    /** 已推送过 session.updated 的会话 id（listSessions 首次发现时 announce，避免无限循环） */
    announced = new Set();
    opts;
    modelCache;
    /** 最近一次请求头里的模型上下文窗口（maxTokens；供 limit.context 百分比计算） */
    modelContext;
    /** provider → 模型目录缓存（listModels 结果） */
    modelsCache = new Map();
    /** 历史会话重建 promise：会话列表/详情请求等待它完成，避免 hydrate 前返回空列表。 */
    hydratePromise;
    constructor(_ctx, opts) {
        this.opts = opts;
    }
    /** 预热模型缓存 + 异步重建历史会话（列表/详情请求会等待）。 */
    init() {
        const selection = this.opts.getSelection();
        if (selection)
            this.modelCache = { id: selection.model, providerID: selection.provider };
        this.hydratePromise = this.runHydrate();
    }
    async runHydrate() {
        const list = (await this.opts.listDshSessions?.()) ?? [];
        for (const item of list) {
            try {
                this.hydrateSession(item.sessionId, item.title, item.preset, item.views, item.todos ?? [], item.diffs ?? [], item.createdAt);
            }
            catch (error) {
                ocLog(`[oc-server] hydrate ${item.sessionId} failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        ocLog(`[oc-server] hydrated ${list.length} sessions`);
    }
    /** 等待历史会话重建完成（带超时兜底，避免 hydrate 挂起卡住请求）。 */
    async waitHydrate() {
        if (!this.hydratePromise)
            return;
        try {
            await Promise.race([
                this.hydratePromise,
                new Promise((resolve) => setTimeout(resolve, 15_000).unref?.()),
            ]);
        }
        catch {
            /* hydrate 失败不阻塞 */
        }
    }
    // ── 会话生命周期 ─────────────────────────────────────────────────────────
    getOrCreateSession(id, directory) {
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
    hydrateSession(dshSessionId, title, preset, views, todos, diffs, dshCreatedAt) {
        const ocSessionId = ocIdFromDsh(dshSessionId);
        const existing = this.sessions.get(ocSessionId);
        const state = existing ?? this.getOrCreateSession(ocSessionId, this.opts.directory);
        state.dshSessionId = dshSessionId;
        if (title)
            state.title = title;
        if (preset)
            state.currentAgent = agentOfPreset(preset);
        if (todos.length > 0)
            state.todos = todos;
        if (diffs.length > 0)
            state.diffs = diffs;
        if (existing)
            return;
        // 使用 DSH 会话的真实创建时间（而非 compat 层启动时刻），
        // 无消息时 updatedAt 也回退到 createdAt，避免空会话全部进 "Today"。
        state.createdAt = dshCreatedAt;
        state.messages = viewsToLegacyMessages(ocSessionId, views, this.selection(), state.currentAgent);
        state.updatedAt = state.messages.reduce((max, m) => Math.max(max, m.info.time.updated ?? m.info.time.created), dshCreatedAt);
    }
    /** 删除会话：从内存移除 + 通知 TUI。返回是否成功。 */
    removeSession(sessionId) {
        const state = this.sessions.get(sessionId);
        if (!state)
            return true; // 已不存在视为成功
        this.sessions.delete(sessionId);
        this.deleted.add(sessionId);
        this.unannounceSession(sessionId);
        // 通知 TUI：从会话列表移除（sync.data.session 的 session.deleted 分支）
        this.pushEvent({
            type: "session.deleted",
            properties: { sessionID: sessionId, info: { id: sessionId } },
        }, state.directory);
        ocLog(`[oc-server] deleted session ${sessionId}`);
        return true;
    }
    /** 某会话是否已被兼容层删除（用于 listSessions 过滤）。 */
    isDeleted(sessionId) {
        return this.deleted.has(sessionId);
    }
    /**
     * 向 TUI 推送 session.updated（sync.data.session 的数据源）。
     * 已 announce 过的会话跳过，避免 listSessions 刷新触发无限循环。
     * 返回是否首次 announce。
     */
    announceSession(state) {
        if (this.announced.has(state.id))
            return false;
        this.announced.add(state.id);
        this.pushSessionEvent(state, {
            type: "session.updated",
            properties: { info: this.infoOf(state) },
        });
        return true;
    }
    /** 会话删除时同时移除 announce 标记（重删/重进需要重新 announce）。 */
    unannounceSession(sessionId) {
        this.announced.delete(sessionId);
    }
    // ── 查询 ─────────────────────────────────────────────────────────────────
    findByDsh(dshSessionId) {
        for (const state of this.sessions.values()) {
            if (state.dshSessionId === dshSessionId)
                return state;
        }
        return undefined;
    }
    findMessage(state, messageId) {
        return state.messages.find((m) => m.info.id === messageId);
    }
    getSessionIdByDsh(dshSessionId) {
        return this.findByDsh(dshSessionId)?.id;
    }
    // ── 模型选择 ─────────────────────────────────────────────────────────────
    selection() {
        const sel = this.opts.getSelection();
        if (sel)
            return { id: sel.model, providerID: sel.provider };
        return this.modelCache;
    }
    /** 会话模型：会话切换的模型优先，否则全局 selection。 */
    sessionModel(state) {
        return state.currentModel ?? this.selection();
    }
    /** 列出 provider 的全部模型（带缓存）。 */
    async listModels(provider) {
        if (!this.opts.listModels)
            return [];
        const cached = this.modelsCache.get(provider);
        if (cached)
            return cached;
        try {
            const models = await this.opts.listModels(provider);
            this.modelsCache.set(provider, models);
            return models;
        }
        catch {
            return [];
        }
    }
    // ── 会话信息聚合（侧边栏 Context/输入框 meta 的数据源）──────────────────
    infoOf(state) {
        // 聚合会话级 token/成本（侧边栏 Context 区、输入框 meta 行的 session.cost）
        const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
        let cost = 0;
        for (const m of state.messages) {
            if (m.info.role !== "assistant" || !m.info.tokens)
                continue;
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
    pushEvent(event, directory) {
        if (process.env.DSH_OC_NO_EVENTS === "1")
            return;
        const payload = JSON.stringify({
            directory,
            payload: { type: event.type, properties: event.properties },
        });
        for (const res of this.globalSse) {
            try {
                res.write(`event: ${event.type}\ndata: ${payload}\n\n`);
            }
            catch {
                /* 断连由 close 清理 */
            }
        }
    }
    pushSessionEvent(state, event) {
        this.pushEvent(event, state.directory);
    }
    /** 会话变更通知（新会话进 sync.data.session、聚合 token/cost 刷新）。 */
    touchSession(state) {
        state.updatedAt = Date.now();
        this.pushSessionEvent(state, {
            type: "session.updated",
            properties: { info: this.infoOf(state) },
        });
    }
}
//# sourceMappingURL=session-store.js.map