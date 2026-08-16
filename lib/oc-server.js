/**
 * opencode server 协议兼容层（DSH 侧）。
 *
 * 实现 opencode TUI（fork dev 构建的 lildax）需要的 HTTP 端点：
 * 旧路径（/session、/session/:id/message、/global/event …）+ v2（/api/*），
 * 数据源为 DSH 的 agent/会话（通过 AgentManager + 事件订阅）。
 *
 * TUI 启动方式：`OPENCODE_URL=http://127.0.0.1:<port> lildax`
 * （fork 的 default.ts 已 patch 支持该环境变量）。
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { located, makeSessionInfo, ocId, makeAgentInfo, legacyModelFromV2, } from "./oc-proto.js";
// ── 权限模式 agent（TUI Tab 轮换）→ DSH permission preset ────────────────
// opencode 的 agent 选择在 TUI 里由 Tab 轮换（agent.cycle）；我们把每个
// agent 映射为 DSH 的 sandbox preset，发消息时把 preset 应用到 DSH 会话。
// 列表顺序即 TUI 初始选择与 Tab 轮换顺序：默认 workspace-write（与 DSH
// 默认 preset 一致）→ 更严格 read-only → 更宽松 full-access → 循环。
const PERMISSION_AGENTS = {
    "read-only": "read-only",
    "workspace-write": "workspace-write",
    "full-access": "danger-full-access",
};
const DEFAULT_AGENT = "workspace-write";
const AGENT_DESCRIPTIONS = {
    "read-only": "Read-only sandbox: reads and searches allowed, writes require approval",
    "workspace-write": "Write inside the workspace; wider retries require approval",
    "full-access": "Full file access without approval prompts",
};
/** DSH preset 名 → TUI agent 名（未知/缺失回退默认）。 */
function agentOfPreset(preset) {
    if (preset) {
        for (const [agent, p] of Object.entries(PERMISSION_AGENTS)) {
            if (p === preset)
                return agent;
        }
    }
    return DEFAULT_AGENT;
}
/** 文件修改类工具：arguments 里通常带 path/filePath/file 字段。 */
const FILE_TOOL_NAMES = new Set([
    "write",
    "edit",
    "rename",
    "move",
    "delete",
    "remove",
    "copy",
    "fs_write",
    "fs_edit",
    "fs_rename",
    "fs_move",
    "fs_delete",
    "fs_remove",
    "fs_copy",
    "str-replace-editor",
]);
// ── 日志：写文件（终端保持干净；请求级日志需 DSH_OC_DEBUG=1）─────────────
const ocLogDir = () => {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    return join(dshHome, "logs");
};
function ocLog(message) {
    try {
        mkdirSync(ocLogDir(), { recursive: true });
        appendFileSync(join(ocLogDir(), "oc-server.log"), `${new Date().toISOString()} ${message}\n`);
    }
    catch {
        /* 日志失败不影响主流程 */
    }
}
// ── server ─────────────────────────────────────────────────────────────────
export class OcServer {
    sessions = new Map();
    globalSse = new Set();
    opts;
    ctx;
    http;
    port = 0;
    modelCache;
    /** 最近一次请求头里的模型上下文窗口（maxTokens；供 limit.context 百分比计算） */
    modelContext;
    /** provider → 模型目录缓存（listModels 结果） */
    modelsCache = new Map();
    /** 历史会话重建 promise：会话列表/详情请求等待它完成，避免 hydrate 前返回空列表。 */
    hydratePromise;
    constructor(ctx, opts) {
        this.ctx = ctx;
        this.opts = opts;
        this.http = createServer((req, res) => void this.handle(req, res).catch(() => this.sendJson(res, 500, { _tag: "UnknownError", message: "internal error" })));
    }
    async start() {
        await new Promise((resolve) => this.http.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
        const addr = this.http.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        ocLog(`[oc-server] listening on ${this.url}`);
        // 预热模型缓存
        const selection = this.opts.getSelection();
        if (selection)
            this.modelCache = { id: selection.model, providerID: selection.provider };
        // 从 DSH 持久层重建历史会话（异步，不阻塞 TUI 启动；列表/详情请求会等待）
        this.hydratePromise = this.runHydrate();
        return this.port;
    }
    async runHydrate() {
        const list = (await this.opts.listDshSessions?.()) ?? [];
        for (const item of list) {
            try {
                this.hydrateSession(item.sessionId, item.title, item.preset, item.views, item.todos ?? [], item.diffs ?? []);
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
    get url() {
        return `http://127.0.0.1:${this.port}`;
    }
    async stop() {
        await new Promise((resolve) => this.http.close(() => resolve()));
    }
    // ── 工具 ─────────────────────────────────────────────────────────────────
    sendJson(res, status, body) {
        const payload = JSON.stringify(body);
        res.writeHead(status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
        });
        res.end(payload);
    }
    sseHeaders(res) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
    }
    /** 推旧协议事件（{directory, payload: {type, properties}}）到全局事件流。 */
    pushLegacyEvent(event, directory) {
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
        this.pushLegacyEvent(event, state.directory);
    }
    /** 会话变更通知（新会话进 sync.data.session、聚合 token/cost 刷新）。 */
    touchSession(state) {
        state.updatedAt = Date.now();
        this.pushSessionEvent(state, {
            type: "session.updated",
            properties: { info: this.infoOf(state) },
        });
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
        this.touchSession(state);
    }
    sessionOr404(state, res) {
        if (state)
            return true;
        this.sendJson(res, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
        return false;
    }
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
    hydrateSession(dshSessionId, title, preset, views, todos, diffs) {
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
        state.messages = viewsToLegacyMessages(ocSessionId, views, this.selection(), state.currentAgent);
        for (const m of state.messages) {
            state.updatedAt = Math.max(state.updatedAt, m.info.time.updated ?? m.info.time.created);
        }
    }
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
    // ── 事件映射：DSH 事件 → 旧协议事件 ─────────────────────────────────────
    /** 由 plugin 在 ctx.on('session/event') 中调用。 */
    handleDshEvent(session, event) {
        const state = this.findByDsh(session.id);
        if (!state)
            return;
        switch (event.type) {
            case "turn/start": {
                state.busy = true;
                state.updatedAt = Date.now();
                const sel = this.sessionModel(state) ?? { id: "model", providerID: "provider" };
                const pending = {
                    messageId: ocId("msg"),
                    agent: state.currentAgent,
                    model: sel,
                    startedAt: Date.now(),
                    text: "",
                    textPartId: ocId("text"),
                    reasoning: "",
                    reasoningPartId: ocId("reasoning"),
                    tools: new Map(),
                };
                state.pending = pending;
                this.pushSessionEvent(state, {
                    type: "session.status",
                    properties: { sessionID: state.id, status: { type: "busy" } },
                });
                const info = {
                    id: pending.messageId,
                    sessionID: state.id,
                    role: "assistant",
                    time: { created: pending.startedAt, updated: pending.startedAt },
                    agent: state.currentAgent,
                    model: { providerID: sel.providerID, modelID: sel.id },
                    modelID: sel.id,
                    providerID: sel.providerID,
                    mode: "primary",
                    path: { cwd: state.directory, root: state.directory },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                };
                state.messages.push({ info, parts: [] });
                this.pushSessionEvent(state, {
                    type: "message.updated",
                    properties: { info },
                });
                break;
            }
            case "assistant/chunk": {
                const pending = state.pending;
                if (!pending)
                    break;
                const data = event.data;
                const chunk = data.chunk;
                if (!chunk)
                    break;
                if (chunk.type === "text-delta" && chunk.text) {
                    pending.text += chunk.text;
                    const msg = this.findMessage(state, pending.messageId);
                    if (msg) {
                        msg.info.time.updated = Date.now();
                    }
                    this.pushSessionEvent(state, {
                        type: "message.part.updated",
                        properties: { part: {
                                id: pending.textPartId,
                                sessionID: state.id,
                                messageID: pending.messageId,
                                type: "text",
                                text: pending.text,
                                time: { start: pending.startedAt },
                            },
                            delta: chunk.text,
                        },
                    });
                }
                else if (chunk.type === "reasoning-delta" && chunk.text) {
                    pending.reasoning += chunk.text;
                    this.pushSessionEvent(state, {
                        type: "message.part.updated",
                        properties: { part: {
                                id: pending.reasoningPartId,
                                sessionID: state.id,
                                messageID: pending.messageId,
                                type: "reasoning",
                                text: pending.reasoning,
                                time: { start: pending.startedAt },
                            },
                            delta: chunk.text,
                        },
                    });
                }
                else if (chunk.type === "tool-call-delta") {
                    const callID = chunk.id ?? "call_unknown";
                    let tool = pending.tools.get(callID);
                    if (!tool) {
                        tool = {
                            callID,
                            name: chunk.name ?? "tool",
                            state: { status: "running" },
                            inputArgs: "",
                            createdAt: Date.now(),
                        };
                        pending.tools.set(callID, tool);
                        this.pushSessionEvent(state, {
                            type: "message.part.updated",
                            properties: { part: this.toolPart(state, pending, tool) },
                        });
                    }
                    tool.inputArgs += chunk.arguments ?? "";
                }
                else if (chunk.type === "block-end") {
                    // reasoning/text 块结束：推最终 part 状态（time.end 停止 spinner 并变灰）
                    const block = chunk.block;
                    const now = Date.now();
                    if (block?.type === "reasoning" && pending.reasoning) {
                        this.pushSessionEvent(state, {
                            type: "message.part.updated",
                            properties: {
                                part: {
                                    id: pending.reasoningPartId,
                                    sessionID: state.id,
                                    messageID: pending.messageId,
                                    type: "reasoning",
                                    text: pending.reasoning,
                                    time: { start: pending.startedAt, end: now },
                                },
                            },
                        });
                    }
                    else if (block?.type === "text" && pending.text) {
                        this.pushSessionEvent(state, {
                            type: "message.part.updated",
                            properties: {
                                part: {
                                    id: pending.textPartId,
                                    sessionID: state.id,
                                    messageID: pending.messageId,
                                    type: "text",
                                    text: pending.text,
                                    time: { start: pending.startedAt, end: now },
                                },
                            },
                        });
                    }
                }
                break;
            }
            case "tool/call": {
                const data = event.data;
                const name = data.name ?? "tool";
                // 文件修改类工具 → 会话 Modified Files（侧边栏 Files 区；不依赖 pending）
                if (FILE_TOOL_NAMES.has(name)) {
                    try {
                        const args = data.arguments ? JSON.parse(data.arguments) : {};
                        const file = (args.path ?? args.file_path ?? args.filePath ?? args.file ?? args.paths?.[0]);
                        if (typeof file === "string" && file.trim()) {
                            if (!state.diffs.some((d) => d.file === file)) {
                                state.diffs.push({ file, before: "", after: "", additions: 1, deletions: 0 });
                                this.pushSessionEvent(state, {
                                    type: "session.diff",
                                    properties: { sessionID: state.id, diff: state.diffs },
                                });
                            }
                        }
                    }
                    catch {
                        /* arguments 解析失败不阻塞 */
                    }
                }
                const pending = state.pending;
                if (!pending)
                    break;
                const callID = data.callId ?? ocId("call");
                let tool = pending.tools.get(callID);
                if (!tool) {
                    tool = {
                        callID,
                        name,
                        state: { status: "running" },
                        inputArgs: "",
                        createdAt: Date.now(),
                    };
                    pending.tools.set(callID, tool);
                }
                tool.name = name;
                let input = {};
                try {
                    input = data.arguments ? JSON.parse(data.arguments) : {};
                }
                catch {
                    input = { raw: data.arguments };
                }
                tool.state.input = input;
                this.pushSessionEvent(state, {
                    type: "message.part.updated",
                    properties: { part: this.toolPart(state, pending, tool) },
                });
                break;
            }
            case "tool/result": {
                const pending = state.pending;
                if (!pending)
                    break;
                const data = event.data;
                const message = data.message;
                const callID = message?.content?.[0]?.callId ?? "call_unknown";
                const resultText = message ? toolResultText(message) : "";
                const tool = pending.tools.get(callID);
                if (tool) {
                    tool.state = data.error || resultText.startsWith("Error:")
                        ? { ...tool.state, status: "error", error: resultText || data.error?.name || "tool error" }
                        : { ...tool.state, status: "completed", content: [{ type: "text", text: resultText }], result: resultText };
                    this.pushSessionEvent(state, {
                        type: "message.part.updated",
                        properties: { part: this.toolPart(state, pending, tool) },
                    });
                }
                break;
            }
            case "todo/write": {
                // DSH todo 快照 → opencode Todo（侧边栏 Todo 区）
                const data = event.data;
                const list = Array.isArray(data) ? data : data.todos;
                if (Array.isArray(list)) {
                    state.todos = list.map((item) => ({
                        id: `td_${Math.random().toString(36).slice(2, 10)}`,
                        content: item.content ?? "",
                        status: item.status ?? "pending",
                        priority: "medium",
                    }));
                    this.pushSessionEvent(state, {
                        type: "todo.updated",
                        properties: { sessionID: state.id, todos: state.todos },
                    });
                }
                break;
            }
            case "assistant/message": {
                // DSH 完成一条 assistant 消息：记录 usage（token 统计，供侧边栏/输入框 meta 显示）
                const pending = state.pending;
                if (pending) {
                    const data = event.data;
                    const u = data.usage;
                    if (u) {
                        pending.tokens = {
                            input: u.inputTokens ?? 0,
                            output: u.outputTokens ?? 0,
                            reasoning: u.reasoningTokens ?? 0,
                            cacheRead: u.cacheReadTokens ?? 0,
                            cacheWrite: u.cacheWriteTokens ?? 0,
                        };
                    }
                }
                break;
            }
            case "request/header": {
                // 记录模型上下文窗口（maxTokens），用于 limit.context 的百分比计算
                const data = event.data;
                const maxTokens = data.header?.config?.maxTokens;
                if (typeof maxTokens === "number" && maxTokens > 0)
                    this.modelContext = maxTokens;
                break;
            }
            case "turn/end": {
                const pending = state.pending;
                if (pending) {
                    const data = event.data;
                    const kind = data.reason?.kind;
                    const finish = kind === "completed" ? "end_turn" : kind === "aborted" || kind === "interrupted" ? "canceled" : kind === "error" ? "error" : "end_turn";
                    pending.finish = finish;
                    pending.endedAt = Date.now();
                    const msg = this.findMessage(state, pending.messageId);
                    if (msg) {
                        msg.info.time.updated = pending.endedAt;
                        msg.info.time.completed = pending.endedAt;
                        msg.info.finish = finish;
                        // usage → tokens（侧边栏 Context/命中率、输入框 meta 行的数据源）
                        if (pending.tokens) {
                            const t = pending.tokens;
                            msg.info.tokens = {
                                input: t.input,
                                output: t.output,
                                reasoning: t.reasoning,
                                cache: { read: t.cacheRead, write: t.cacheWrite },
                            };
                            msg.info.cost = 0;
                        }
                        if (!msg.info.parentID) {
                            const userMsg = [...state.messages].reverse().find((m) => m.info.role === "user");
                            msg.info.parentID = userMsg?.info.id;
                        }
                        msg.parts = [];
                        if (pending.text) {
                            msg.parts.push({
                                id: pending.textPartId,
                                sessionID: state.id,
                                messageID: pending.messageId,
                                type: "text",
                                text: pending.text,
                                time: { start: pending.startedAt, end: pending.endedAt },
                            });
                        }
                        if (pending.reasoning) {
                            msg.parts.push({
                                id: pending.reasoningPartId,
                                sessionID: state.id,
                                messageID: pending.messageId,
                                type: "reasoning",
                                text: pending.reasoning,
                                time: { start: pending.startedAt, end: pending.endedAt },
                            });
                        }
                        for (const tool of pending.tools.values()) {
                            msg.parts.push(this.toolPart(state, pending, tool));
                        }
                        // 推最终 part 状态（time.end 使 reasoning/text 的 spinner 停止、变灰）
                        if (pending.reasoning) {
                            this.pushSessionEvent(state, {
                                type: "message.part.updated",
                                properties: {
                                    part: {
                                        id: pending.reasoningPartId,
                                        sessionID: state.id,
                                        messageID: pending.messageId,
                                        type: "reasoning",
                                        text: pending.reasoning,
                                        time: { start: pending.startedAt, end: pending.endedAt },
                                    },
                                },
                            });
                        }
                        if (pending.text) {
                            this.pushSessionEvent(state, {
                                type: "message.part.updated",
                                properties: {
                                    part: {
                                        id: pending.textPartId,
                                        sessionID: state.id,
                                        messageID: pending.messageId,
                                        type: "text",
                                        text: pending.text,
                                        time: { start: pending.startedAt, end: pending.endedAt },
                                    },
                                },
                            });
                        }
                        this.pushSessionEvent(state, {
                            type: "message.updated",
                            properties: { info: msg.info },
                        });
                    }
                    state.pending = undefined;
                }
                state.busy = false;
                state.updatedAt = Date.now();
                this.pushSessionEvent(state, {
                    type: "session.status",
                    properties: { sessionID: state.id, status: { type: "idle" } },
                });
                // 会话级 token/cost 聚合变化（侧边栏 Context 区刷新）
                this.touchSession(state);
                break;
            }
            case "user/message": {
                const data = event.data;
                const text = userTextFromMessage(data);
                if (!text.trim())
                    break;
                // 过滤系统注入：runtime context / sandbox 快照等（plugin 来源）不进消息列表
                if (data.source && data.source.kind !== "user")
                    break;
                const now = Date.now();
                // 去重：用户消息已由 POST /session/:id/message 添加（同文本、时间接近时跳过）
                const lastUser = [...state.messages].reverse().find((m) => m.info.role === "user");
                if (lastUser && now - lastUser.info.time.created < 5000) {
                    const lastText = lastUser.parts.find((p) => p.type === "text")?.text;
                    if (lastText === text)
                        break;
                }
                const messageId = ocId("msg");
                const partId = ocId("text");
                const sel = this.sessionModel(state);
                const info = {
                    id: messageId,
                    sessionID: state.id,
                    role: "user",
                    time: { created: now, updated: now },
                    agent: state.currentAgent,
                    model: { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" },
                };
                state.messages.push({
                    info,
                    parts: [
                        {
                            id: partId,
                            sessionID: state.id,
                            messageID: messageId,
                            type: "text",
                            text,
                            time: { start: now, end: now },
                        },
                    ],
                });
                this.pushSessionEvent(state, {
                    type: "message.updated",
                    properties: { info },
                });
                this.pushSessionEvent(state, {
                    type: "message.part.updated",
                    properties: {
                        part: {
                            id: partId,
                            sessionID: state.id,
                            messageID: messageId,
                            type: "text",
                            text,
                            time: { start: now, end: now },
                        },
                    },
                });
                break;
            }
            default: {
                if (event.type === "session/title") {
                    const data = event.data;
                    if (data?.title) {
                        state.title = data.title;
                        this.pushSessionEvent(state, {
                            type: "session.updated",
                            properties: { info: this.legacySessionInfo(state) },
                        });
                    }
                }
                break;
            }
        }
    }
    /** DSH approval/request → opencode permission 对话框；返回决议结果。 */
    handleApproval(dshSessionId, request) {
        const state = this.findByDsh(dshSessionId);
        if (!state)
            return undefined;
        const permissionID = `perm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const lastMsg = [...state.messages].reverse().find((m) => m.info.role === "assistant");
        const permission = {
            id: permissionID,
            sessionID: state.id,
            permission: request.toolName,
            patterns: [],
            metadata: { reason: request.reason ?? "", title: `Allow ${request.toolName}?` },
            always: [],
            ...(request.callId ? { tool: { messageID: lastMsg?.info.id ?? "", callID: request.callId } } : {}),
        };
        return new Promise((resolve) => {
            state.permissions.set(permissionID, resolve);
            this.pushSessionEvent(state, {
                type: "permission.asked",
                properties: permission,
            });
            // 超时兜底：30s 无应答按拒绝（fail-closed）
            setTimeout(() => {
                const pending = state.permissions.get(permissionID);
                if (pending) {
                    state.permissions.delete(permissionID);
                    pending("rejected");
                }
            }, 30_000).unref?.();
        });
    }
    /** DSH user question → opencode question 对话框；返回应答（labels 按问题顺序）。 */
    handleQuestion(dshSessionId, items) {
        const state = this.findByDsh(dshSessionId);
        if (!state) {
            ocLog(`[oc-server] question: no session for ${dshSessionId}`);
            return undefined;
        }
        ocLog(`[oc-server] question: ${items.length} item(s) for ${state.id}`);
        const requestID = `ques_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const questions = items.map((item) => ({
            question: item.question,
            header: item.header ?? item.question.slice(0, 30),
            ...(item.detail ? { detail: item.detail } : {}),
            ...(item.options && item.options.length > 0
                ? { options: item.options.map((o) => ({ label: o.label, ...(o.description ? { hint: o.description } : {}) })) }
                : {}),
            ...(item.multiSelect ? { multiple: true } : {}),
        }));
        return new Promise((resolve) => {
            state.questions.set(requestID, (rawAnswers) => {
                const labels = Array.isArray(rawAnswers) ? rawAnswers : [];
                const answers = items.map((item, i) => ({
                    id: item.id,
                    selected: Array.isArray(labels[i]) ? labels[i] : [],
                }));
                resolve({ answers });
            });
            this.pushSessionEvent(state, {
                type: "question.asked",
                properties: { id: requestID, sessionID: state.id, questions },
            });
            // 超时兜底：60s 无应答按空答案结算
            setTimeout(() => {
                const pending = state.questions.get(requestID);
                if (pending) {
                    state.questions.delete(requestID);
                    pending({ answers: [] });
                }
            }, 60_000).unref?.();
        });
    }
    toolPart(state, pending, tool) {
        return {
            id: tool.callID,
            sessionID: state.id,
            messageID: pending.messageId,
            type: "tool",
            tool: tool.name,
            state: tool.state,
            callID: tool.callID,
            time: { start: tool.createdAt, end: Date.now() },
        };
    }
    findMessage(state, messageId) {
        return state.messages.find((m) => m.info.id === messageId);
    }
    findByDsh(dshSessionId) {
        for (const state of this.sessions.values()) {
            if (state.dshSessionId === dshSessionId)
                return state;
        }
        return undefined;
    }
    // ── HTTP 路由 ────────────────────────────────────────────────────────────
    /** v2 端点（/api/*）。返回是否已处理。 */
    async handleApi(path, method, body, url, req, res) {
        // ── v2 端点 ──
        if (path === "/api/health" && method === "GET") {
            this.sendJson(res, 200, { healthy: true });
            return true;
        }
        if (path === "/api/location" && method === "GET") {
            this.sendJson(res, 200, located({ directory: this.opts.directory, project: { id: projectIdOf(this.opts.directory), directory: this.opts.directory } }, this.opts.directory));
            return true;
        }
        if (path === "/api/agent" && method === "GET") {
            const agents = [
                makeAgentInfo("workspace-write", AGENT_DESCRIPTIONS["workspace-write"]),
                makeAgentInfo("read-only", AGENT_DESCRIPTIONS["read-only"]),
                makeAgentInfo("full-access", AGENT_DESCRIPTIONS["full-access"]),
            ];
            this.sendJson(res, 200, located(agents, this.opts.directory));
            return true;
        }
        if (path === "/api/provider" && method === "GET") {
            const provider = await this.legacyProvider();
            this.sendJson(res, 200, located(provider ? [provider] : [], this.opts.directory));
            return true;
        }
        if (path === "/api/model" && method === "GET") {
            const provider = await this.legacyProvider();
            const models = provider ? Object.values(provider.models).map((m) => ({ id: m.id, providerID: m.providerID, family: m.family, name: m.name })) : [];
            this.sendJson(res, 200, located(models, this.opts.directory));
            return true;
        }
        if (path === "/api/integration" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return true;
        }
        if (path === "/api/reference" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return true;
        }
        if (path === "/api/command" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return true;
        }
        if (path === "/api/skill" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return true;
        }
        if (path === "/api/event" && method === "GET") {
            this.sseHeaders(res);
            this.globalSse.add(res);
            res.write(": connected\n\n");
            req.on("close", () => this.globalSse.delete(res));
            return true;
        }
        const sessionMatch = path.match(/^\/api\/session\/([^/]+)(?:\/([^/]+))?$/);
        if (sessionMatch) {
            const sessionId = sessionMatch[1];
            const sub = sessionMatch[2];
            if (method === "GET")
                await this.waitHydrate();
            if (method === "GET" && !sub) {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
                }
                return true;
            }
            if (method === "POST" && !sub) {
                const payload = body ? safeParse(body) : {};
                const id = payload.id ?? ocId("ses");
                const state = this.getOrCreateSession(id, this.opts.directory);
                // 新会话进 sync.data.session（TUI 的 session 页/侧边栏依赖它）
                this.touchSession(state);
                this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
                return true;
            }
            if (method === "POST" && sub === "prompt") {
                const state = this.sessions.get(sessionId) ?? this.getOrCreateSession(sessionId, this.opts.directory);
                const payload = body ? safeParse(body) : {};
                const prompt = payload.prompt;
                const text = typeof prompt === "string" ? prompt : (prompt?.text ?? "");
                if (!text) {
                    this.sendJson(res, 400, { _tag: "InvalidRequestError", message: "empty prompt" });
                    return true;
                }
                if (typeof payload.agent === "string" && payload.agent in PERMISSION_AGENTS)
                    state.currentAgent = payload.agent;
                this.applyRequestModel(state, payload);
                const admitted = { messageID: ocId("msg"), delivery: "direct" };
                this.runPrompt(state, text, { preset: PERMISSION_AGENTS[state.currentAgent] });
                this.sendJson(res, 200, located(admitted, this.opts.directory));
                return true;
            }
            if (method === "POST" && sub === "interrupt") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "wait") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "compact") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "GET" && sub === "event") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sseHeaders(res);
                    state.sse.add(res);
                    res.write(": connected\n\n");
                    req.on("close", () => state.sse.delete(res));
                }
                return true;
            }
            if (method === "GET" && sub === "message") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    const limit = Number(url.searchParams.get("limit") ?? 50);
                    const messages = state.messages.slice(-limit);
                    this.sendJson(res, 200, located({ data: messages, cursor: {} }, this.opts.directory));
                }
                return true;
            }
            if (method === "GET" && sub === "todo") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: state.todos }, this.opts.directory));
                }
                return true;
            }
            if (method === "GET" && sub === "diff") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: state.diffs }, this.opts.directory));
                }
                return true;
            }
            if (method === "GET" && sub === "context") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located(state.messages, this.opts.directory));
                }
                return true;
            }
            if (method === "GET" && sub === "history") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: [], hasMore: false }, this.opts.directory));
                }
                return true;
            }
            if (method === "POST" && sub === "agent") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "model") {
                this.sendJson(res, 200, {});
                return true;
            }
            this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
            return true;
        }
        if (path === "/api/session/active" && method === "GET") {
            const active = {};
            for (const [id, state] of this.sessions) {
                if (state.busy)
                    active[id] = { type: "running" };
            }
            this.sendJson(res, 200, located(active, this.opts.directory));
            return true;
        }
        if (path === "/api/session" && method === "GET") {
            const list = Array.from(this.sessions.values()).map((s) => this.infoOf(s));
            this.sendJson(res, 200, located({ data: list, cursor: {} }, this.opts.directory));
            return true;
        }
        if (path === "/api/session" && method === "POST") {
            const payload = body ? safeParse(body) : {};
            const id = payload.id ?? ocId("ses");
            const state = this.getOrCreateSession(id, this.opts.directory);
            this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
            return true;
        }
        const v2SessionDelete = path.match(/^\/api\/session\/([^/]+)$/);
        if (v2SessionDelete && method === "DELETE") {
            const ok = await this.deleteSession(v2SessionDelete[1]);
            this.sendJson(res, ok ? 200 : 500, located(ok, this.opts.directory));
            return true;
        }
        // ── v2 permission reply ──
        const permReply = path.match(/^\/permission\/([^/]+)\/reply$/);
        if (permReply && method === "POST") {
            const requestID = permReply[1];
            const payload = body ? safeParse(body) : {};
            const reply = (payload.reply ?? payload.response);
            // 查找挂起的审批
            for (const state of this.sessions.values()) {
                const resolve = state.permissions.get(requestID);
                if (resolve) {
                    state.permissions.delete(requestID);
                    resolve(reply === "reject" ? "rejected" : "allowed-once");
                    this.pushSessionEvent(state, {
                        type: "permission.replied",
                        properties: { sessionID: state.id, permissionID: requestID, response: reply ?? "reject" },
                    });
                    break;
                }
            }
            this.sendJson(res, 200, {});
            return true;
        }
        // ── v2 question reply/reject ──
        const qReply = path.match(/^\/question\/([^/]+)\/reply$/);
        if (qReply && method === "POST") {
            const requestID = qReply[1];
            const payload = body ? safeParse(body) : {};
            const answers = Array.isArray(payload.answers) ? payload.answers : [];
            for (const state of this.sessions.values()) {
                const resolve = state.questions.get(requestID);
                if (resolve) {
                    state.questions.delete(requestID);
                    resolve(answers);
                    this.pushSessionEvent(state, {
                        type: "question.replied",
                        properties: { sessionID: state.id, requestID },
                    });
                    break;
                }
            }
            this.sendJson(res, 200, {});
            return true;
        }
        const qReject = path.match(/^\/question\/([^/]+)\/reject$/);
        if (qReject && method === "POST") {
            const requestID = qReject[1];
            for (const state of this.sessions.values()) {
                const resolve = state.questions.get(requestID);
                if (resolve) {
                    state.questions.delete(requestID);
                    resolve({ answers: [] });
                    this.pushSessionEvent(state, {
                        type: "question.rejected",
                        properties: { sessionID: state.id, requestID },
                    });
                    break;
                }
            }
            this.sendJson(res, 200, {});
            return true;
        }
        return false;
    }
    /** 旧协议 /session/:id/* 子路由。返回是否已处理。 */
    async handleLegacySession(path, method, body, url, req, res) {
        // 旧 /session/:id/* 子路由
        const legacySessionMatch = path.match(/^\/session\/([^/]+)(?:\/([^/]+))?$/);
        if (legacySessionMatch) {
            const sessionId = legacySessionMatch[1];
            const sub = legacySessionMatch[2];
            if (method === "GET")
                await this.waitHydrate();
            if (method === "DELETE" && !sub) {
                // 删除会话（会话列表 Ctrl+d）：移除内存状态 + 删 DSH 数据 + 通知 TUI
                const ok = await this.deleteSession(sessionId);
                this.sendJson(res, ok ? 200 : 500, ok);
                return true;
            }
            if (method === "GET" && !sub) {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, this.legacySession(state));
                }
                return true;
            }
            if (method === "GET" && sub === "message") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, state.messages);
                }
                return true;
            }
            if (method === "POST" && sub === "message") {
                // 发送消息（旧协议）：body {agent?, model?, parts: [{type:"text", text}]}
                const state = this.sessions.get(sessionId) ?? this.getOrCreateSession(sessionId, this.opts.directory);
                const payload = body ? safeParse(body) : {};
                if (typeof payload.agent === "string" && payload.agent in PERMISSION_AGENTS)
                    state.currentAgent = payload.agent;
                this.applyRequestModel(state, payload);
                const parts = Array.isArray(payload.parts) ? payload.parts : [];
                const textPart = parts.find((p) => p?.type === "text");
                const text = textPart?.text ?? "";
                if (!text) {
                    this.sendJson(res, 400, { _tag: "BadRequestError", message: "empty message" });
                    return true;
                }
                // 用户消息立即落库并推送
                const messageId = ocId("msg");
                const now = Date.now();
                const sel = this.sessionModel(state);
                const info = {
                    id: messageId,
                    sessionID: state.id,
                    role: "user",
                    time: { created: now, updated: now },
                    agent: state.currentAgent,
                    model: { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" },
                };
                const partId = ocId("text");
                state.messages.push({
                    info,
                    parts: [{ id: partId, sessionID: state.id, messageID: messageId, type: "text", text, time: { start: now, end: now } }],
                });
                this.pushSessionEvent(state, { type: "message.updated", properties: { info } });
                // 推 part 事件：user 消息文本实时进 TUI 的 parts（否则消息列表里不显示，
                // 只有重启 hydrate 后才有——TUI 的 sync 不会为后续消息重跑）
                this.pushSessionEvent(state, {
                    type: "message.part.updated",
                    properties: {
                        part: {
                            id: partId,
                            sessionID: state.id,
                            messageID: messageId,
                            type: "text",
                            text,
                            time: { start: now, end: now },
                        },
                    },
                });
                // 触发 DSH agent（当前 agent 映射的 preset 应用到 DSH 会话）
                this.runPrompt(state, text, { preset: PERMISSION_AGENTS[state.currentAgent] });
                // 响应占位 assistant 消息（TUI 期待 {info, parts}）
                const pendingId = ocId("msg");
                const sel2 = this.sessionModel(state);
                const placeholder = {
                    id: pendingId,
                    sessionID: state.id,
                    role: "assistant",
                    time: { created: now },
                    agent: state.currentAgent,
                    model: { providerID: sel2?.providerID ?? "provider", modelID: sel2?.id ?? "model" },
                    parentID: messageId,
                    modelID: sel2?.id,
                    providerID: sel2?.providerID,
                    mode: "primary",
                    path: { cwd: state.directory, root: state.directory },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                };
                this.sendJson(res, 200, { info: placeholder, parts: [] });
                return true;
            }
            if (method === "GET" && sub === "todo") {
                const st = this.sessions.get(sessionId);
                this.sendJson(res, 200, st ? st.todos : []);
                return true;
            }
            if (method === "GET" && sub === "diff") {
                const st = this.sessions.get(sessionId);
                this.sendJson(res, 200, st ? st.diffs : []);
                return true;
            }
            if (method === "POST" && sub === "abort") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "permissions") {
                // POST /session/:id/permissions/:permissionID，body {response: "once"|"always"|"reject"}
                const m2 = path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/);
                if (m2) {
                    const state = this.sessions.get(m2[1]);
                    if (!state) {
                        this.sendJson(res, 404, { _tag: "NotFoundError", message: "Session not found" });
                        return true;
                    }
                    const permissionID = m2[2];
                    const payload = body ? safeParse(body) : {};
                    const response = payload.response;
                    const resolve = state.permissions.get(permissionID);
                    if (resolve) {
                        state.permissions.delete(permissionID);
                        const outcome = response === "reject" ? "rejected" : "allowed-once";
                        resolve(outcome);
                    }
                    this.pushSessionEvent(state, {
                        type: "permission.replied",
                        properties: {
                            sessionID: state.id,
                            permissionID,
                            response: response ?? "reject",
                        },
                    });
                    this.sendJson(res, 200, {});
                    return true;
                }
                this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
                return true;
            }
            if (method === "POST" && sub === "summarize") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "command") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "shell") {
                this.sendJson(res, 200, {});
                return true;
            }
            if (method === "POST" && sub === "prompt_async") {
                const state = this.sessions.get(sessionId) ?? this.getOrCreateSession(sessionId, this.opts.directory);
                const payload = body ? safeParse(body) : {};
                const prompt = payload.prompt;
                const text = typeof prompt === "string" ? prompt : (prompt?.text ?? "");
                if (text) {
                    void this.opts
                        .onPrompt(text, { resumeSessionId: state.dshSessionId }, { onSession: (dshId) => this.bindDshSession(state.id, dshId) })
                        .then((dshId) => {
                        if (dshId)
                            this.bindDshSession(state.id, dshId);
                    });
                }
                this.sendJson(res, 200, { ok: true });
                return true;
            }
            this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
            return true;
        }
        return false;
    }
    async handle(req, res) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const path = url.pathname;
        const method = req.method ?? "GET";
        if (process.env.DSH_OC_DEBUG === "1")
            ocLog(`[oc-server] ${method} ${path}`);
        // 读取 body
        const body = await readBody(req);
        // ── v2 端点 ──
        if (await this.handleApi(path, method, body, url, req, res))
            return;
        // 旧 /session/:id/* 子路由
        if (await this.handleLegacySession(path, method, body, url, req, res))
            return;
        // ── 旧路径 ──
        if (path === "/path" && method === "GET") {
            this.sendJson(res, 200, {
                home: "/home",
                state: this.opts.directory + "/.oc-state",
                config: this.opts.directory + "/.oc-config",
                worktree: this.opts.directory,
                directory: this.opts.directory,
            });
            return;
        }
        if (path === "/project/current" && method === "GET") {
            this.sendJson(res, 200, {
                id: projectIdOf(this.opts.directory),
                worktree: this.opts.directory,
                time: { created: Date.now() },
                sandboxes: [],
            });
            return;
        }
        if (path === "/config/providers" && method === "GET") {
            const provider = await this.legacyProvider();
            this.sendJson(res, 200, { providers: provider ? [provider] : [], default: {} });
            return;
        }
        if (path === "/provider" && method === "GET") {
            const provider = await this.legacyProvider();
            this.sendJson(res, 200, {
                all: provider ? [provider] : [],
                default: {},
                connected: provider ? [provider.id] : [],
            });
            return;
        }
        if (path === "/experimental/capabilities" && method === "GET") {
            this.sendJson(res, 200, { backgroundSubagents: false });
            return;
        }
        if (path === "/experimental/console" && method === "GET") {
            this.sendJson(res, 200, { consoleManagedProviders: [], switchableOrgCount: 0 });
            return;
        }
        if (path === "/experimental/workspace" && method === "GET") {
            this.sendJson(res, 200, { workspaces: [], current: undefined });
            return;
        }
        if (path === "/agent" && method === "GET") {
            this.sendJson(res, 200, [
                {
                    name: "workspace-write",
                    description: AGENT_DESCRIPTIONS["workspace-write"],
                    mode: "primary",
                    builtIn: true,
                    permission: { edit: "allow", bash: {} },
                    tools: {},
                    options: {},
                },
                {
                    name: "read-only",
                    description: AGENT_DESCRIPTIONS["read-only"],
                    mode: "primary",
                    builtIn: true,
                    permission: { edit: "allow", bash: {} },
                    tools: {},
                    options: {},
                },
                {
                    name: "full-access",
                    description: AGENT_DESCRIPTIONS["full-access"],
                    mode: "primary",
                    builtIn: true,
                    permission: { edit: "allow", bash: {} },
                    tools: {},
                    options: {},
                },
            ]);
            return;
        }
        if (path === "/config" && method === "GET") {
            this.sendJson(res, 200, {});
            return;
        }
        if (path === "/session" && method === "GET") {
            // 等待历史会话重建完成（否则 hydrate 慢时会话列表为空）
            await this.waitHydrate();
            // TUI 默认按项目过滤（?scope=project）；这里按工作目录匹配
            const scope = url.searchParams.get("scope");
            const list = Array.from(this.sessions.values())
                .filter((s) => scope !== "project" || s.directory === this.opts.directory)
                .map((s) => this.legacySession(s));
            this.sendJson(res, 200, list);
            return;
        }
        if (path === "/session" && method === "POST") {
            const payload = body ? safeParse(body) : {};
            const id = payload.id ?? ocId("ses");
            const state = this.getOrCreateSession(id, this.opts.directory);
            // 新会话进 sync.data.session（TUI 的 session 页/侧边栏依赖它）
            this.touchSession(state);
            this.sendJson(res, 200, this.legacySession(state));
            return;
        }
        if (path === "/session/status" && method === "GET") {
            this.sendJson(res, 200, {});
            return;
        }
        if (path === "/provider/auth" && method === "GET") {
            this.sendJson(res, 200, {});
            return;
        }
        if (path === "/vcs" && method === "GET") {
            this.sendJson(res, 200, { branch: undefined, provider: undefined, repo: undefined });
            return;
        }
        if (path === "/command" && method === "GET") {
            this.sendJson(res, 200, []);
            return;
        }
        if (path === "/lsp" && method === "GET") {
            this.sendJson(res, 200, []);
            return;
        }
        if (path === "/mcp" && method === "GET") {
            this.sendJson(res, 200, {});
            return;
        }
        if (path === "/experimental/resource" && method === "GET") {
            this.sendJson(res, 200, {});
            return;
        }
        if (path === "/formatter" && method === "GET") {
            this.sendJson(res, 200, []);
            return;
        }
        if (path === "/global/event" && method === "GET") {
            this.sseHeaders(res);
            this.globalSse.add(res);
            res.write(": connected\n\n");
            req.on("close", () => this.globalSse.delete(res));
            return;
        }
        // 未实现 → opencode 错误格式
        this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
    }
    // ── 响应构造 ─────────────────────────────────────────────────────────────
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
    legacySessionInfo(state) {
        return {
            id: state.id,
            projectID: projectIdOf(state.directory),
            directory: state.directory,
            title: state.title,
            version: "1",
            time: { created: state.createdAt, updated: state.updatedAt },
        };
    }
    async legacyProvider() {
        const sel = this.selection();
        if (!sel)
            return undefined;
        // provider 的全部模型（模型选择窗口数据源）；无目录时回退当前模型
        const catalog = await this.listModels(sel.providerID);
        const models = {};
        if (catalog.length > 0) {
            for (const m of catalog) {
                models[m.id] = legacyModelFromV2({ id: m.id, providerID: sel.providerID, name: m.name || m.id }, m.contextWindow ?? this.modelContext);
            }
        }
        else {
            models[sel.id] = legacyModelFromV2({ id: sel.id, providerID: sel.providerID, name: sel.id }, this.modelContext);
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
    /** 记录 DSH session id 与 opencode session id 的绑定（agent 创建后由 plugin 调用）。 */
    bindDshSession(ocSessionId, dshSessionId) {
        const state = this.sessions.get(ocSessionId);
        if (state) {
            state.dshSessionId = dshSessionId;
            state.updatedAt = Date.now();
        }
    }
    /**
     * 删除会话（DELETE /session/:id）：从内存移除 + 通知 TUI + 删除 DSH 持久化数据。
     * 返回是否成功（false = 会话不存在或删除失败）。
     */
    async deleteSession(sessionId) {
        const state = this.sessions.get(sessionId);
        if (!state)
            return true; // 已不存在视为成功
        // 先删 DSH 侧数据（可能抛错），成功后才移除内存状态
        if (state.dshSessionId && this.opts.onDeleteSession) {
            try {
                await this.opts.onDeleteSession(state.dshSessionId);
            }
            catch (error) {
                ocLog(`[oc-server] delete session ${sessionId} dsh side failed: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        }
        this.sessions.delete(sessionId);
        // 通知 TUI：从会话列表移除（sync.data.session 的 session.deleted 分支）
        this.pushLegacyEvent({
            type: "session.deleted",
            properties: { sessionID: sessionId, info: { id: sessionId } },
        }, state.directory);
        ocLog(`[oc-server] deleted session ${sessionId}`);
        return true;
    }
    getSessionIdByDsh(dshSessionId) {
        return this.findByDsh(dshSessionId)?.id;
    }
}
function projectIdOf(directory) {
    return createHash("sha1").update(directory).digest("hex");
}
/** DSH 会话 id → 稳定 opencode 会话 id（重启后保持一致）。 */
function ocIdFromDsh(dshSessionId) {
    return "ses_" + createHash("sha1").update(dshSessionId).digest("hex").slice(0, 20);
}
/** MessageView[] → 旧协议消息列表（user/assistant/tool 卡）。 */
function viewsToLegacyMessages(sessionID, views, sel, agent) {
    const out = [];
    const model = { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" };
    let currentAssistant;
    for (const v of views) {
        if (v.kind === "user") {
            out.push({
                info: {
                    id: v.id,
                    sessionID,
                    role: "user",
                    time: { created: v.time, updated: v.time },
                    agent,
                    model,
                },
                parts: [
                    { id: ocId("text"), sessionID, messageID: v.id, type: "text", text: v.content, time: { start: v.time, end: v.time } },
                ],
            });
        }
        else if (v.kind === "assistant") {
            const info = {
                id: v.id,
                sessionID,
                role: "assistant",
                time: { created: v.time, updated: v.endedAt ?? v.time, completed: v.endedAt },
                agent,
                model,
                parentID: out.findLast((m) => m.info.role === "user")?.info.id,
                modelID: v.provider ? v.model : sel?.id,
                providerID: v.provider,
                mode: "primary",
                path: { cwd: "", root: "" },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                finish: v.finished ? (v.reason === "completed" ? "end_turn" : v.reason === "aborted" || v.reason === "interrupted" ? "canceled" : "error") : undefined,
            };
            const parts = [];
            if (v.thinking) {
                parts.push({ id: ocId("reasoning"), sessionID, messageID: v.id, type: "reasoning", text: v.thinking, time: { start: v.time, end: v.endedAt } });
            }
            if (v.text) {
                parts.push({ id: ocId("text"), sessionID, messageID: v.id, type: "text", text: v.text, time: { start: v.time, end: v.endedAt } });
            }
            currentAssistant = { info, parts };
            out.push(currentAssistant);
        }
        else if (v.kind === "tool" && currentAssistant) {
            // 工具卡归入当前 assistant 消息的 parts
            const t = v.tool;
            currentAssistant.parts.push({
                id: t.id,
                sessionID,
                messageID: currentAssistant.info.id,
                type: "tool",
                tool: t.name,
                state: {
                    status: t.status === "error" ? "error" : t.status === "done" ? "completed" : "running",
                    input: safeParse(t.arguments),
                    content: t.result ? [{ type: "text", text: t.result }] : [],
                    result: t.result,
                    error: t.error ? t.error.name : undefined,
                },
                callID: t.id,
                time: { start: t.startedAt, end: t.endedAt },
            });
        }
    }
    return out;
}
function userTextFromMessage(message) {
    const blocks = message.content ?? [];
    return blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
}
function toolResultText(message) {
    return userTextFromMessage(message);
}
function safeParse(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
function readBody(req) {
    return new Promise((resolve) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk.toString("utf8");
            if (data.length > 1_000_000)
                req.destroy();
        });
        req.on("end", () => resolve(data));
        req.on("error", () => resolve(data));
    });
}
//# sourceMappingURL=oc-server.js.map