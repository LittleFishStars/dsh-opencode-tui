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
import { located, makeSessionInfo, ocId, makeAgentInfo, legacyModelFromV2, } from "./oc-proto.js";
// ── server ─────────────────────────────────────────────────────────────────
export class OcServer {
    sessions = new Map();
    globalSse = new Set();
    opts;
    ctx;
    http;
    port = 0;
    modelCache;
    constructor(ctx, opts) {
        this.ctx = ctx;
        this.opts = opts;
        this.http = createServer((req, res) => void this.handle(req, res).catch(() => this.sendJson(res, 500, { _tag: "UnknownError", message: "internal error" })));
    }
    async start() {
        await new Promise((resolve) => this.http.listen(this.opts.port ?? 0, "127.0.0.1", resolve));
        const addr = this.http.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        process.stderr.write(`[oc-server] listening on ${this.url}\n`);
        // 预热模型缓存
        const selection = this.opts.getSelection();
        if (selection)
            this.modelCache = { id: selection.model, providerID: selection.provider };
        // 从 DSH 持久层重建历史会话（异步，不阻塞 TUI 启动）
        void this.opts.listDshSessions?.().then((list) => {
            for (const item of list) {
                try {
                    this.hydrateSession(item.sessionId, item.title, item.views);
                }
                catch (error) {
                    process.stderr.write(`[oc-server] hydrate ${item.sessionId} failed: ${error instanceof Error ? error.message : String(error)}\n`);
                }
            }
            process.stderr.write(`[oc-server] hydrated ${list.length} sessions\n`);
        });
        return this.port;
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
    /** 推旧协议事件（{type, properties}）到全局事件流。 */
    pushLegacyEvent(properties) {
        if (process.env.DSH_OC_NO_EVENTS === "1")
            return;
        const payload = JSON.stringify(properties);
        for (const res of this.globalSse) {
            try {
                res.write(`event: ${properties.type}\ndata: ${payload}\n\n`);
            }
            catch {
                /* 断连由 close 清理 */
            }
        }
    }
    pushSessionEvent(state, properties) {
        this.pushLegacyEvent(properties);
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
                messages: [],
                sse: new Set(),
            };
            this.sessions.set(id, state);
        }
        return state;
    }
    /** 把 DSH 会话视图重建为 opencode 会话状态（进程内；ocSessionId 由 dshSessionId 稳定哈希）。 */
    hydrateSession(dshSessionId, title, views) {
        const ocSessionId = ocIdFromDsh(dshSessionId);
        const existing = this.sessions.get(ocSessionId);
        const state = existing ?? this.getOrCreateSession(ocSessionId, this.opts.directory);
        state.dshSessionId = dshSessionId;
        if (title)
            state.title = title;
        if (existing)
            return;
        state.messages = viewsToLegacyMessages(ocSessionId, views, this.selection());
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
                const sel = this.selection() ?? { id: "model", providerID: "provider" };
                const pending = {
                    messageId: ocId("msg"),
                    agent: "build",
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
                    sessionID: state.id,
                    status: { type: "busy" },
                });
                const info = {
                    id: pending.messageId,
                    sessionID: state.id,
                    role: "assistant",
                    time: { created: pending.startedAt, updated: pending.startedAt },
                    agent: "build",
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
                    info,
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
                        part: {
                            id: pending.textPartId,
                            sessionID: state.id,
                            messageID: pending.messageId,
                            type: "text",
                            text: pending.text,
                            time: { start: pending.startedAt },
                        },
                        delta: chunk.text,
                    });
                }
                else if (chunk.type === "reasoning-delta" && chunk.text) {
                    pending.reasoning += chunk.text;
                    this.pushSessionEvent(state, {
                        type: "message.part.updated",
                        part: {
                            id: pending.reasoningPartId,
                            sessionID: state.id,
                            messageID: pending.messageId,
                            type: "reasoning",
                            text: pending.reasoning,
                            time: { start: pending.startedAt },
                        },
                        delta: chunk.text,
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
                            part: this.toolPart(state, pending, tool),
                        });
                    }
                    tool.inputArgs += chunk.arguments ?? "";
                }
                break;
            }
            case "tool/call": {
                const pending = state.pending;
                if (!pending)
                    break;
                const data = event.data;
                const callID = data.callId ?? ocId("call");
                const name = data.name ?? "tool";
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
                    part: this.toolPart(state, pending, tool),
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
                        part: this.toolPart(state, pending, tool),
                    });
                }
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
                        this.pushSessionEvent(state, {
                            type: "message.updated",
                            info: msg.info,
                        });
                    }
                    state.pending = undefined;
                }
                state.busy = false;
                state.updatedAt = Date.now();
                this.pushSessionEvent(state, {
                    type: "session.status",
                    sessionID: state.id,
                    status: { type: "idle" },
                });
                break;
            }
            case "user/message": {
                const data = event.data;
                const text = userTextFromMessage(data);
                if (!text.trim())
                    break;
                const messageId = ocId("msg");
                const now = Date.now();
                const sel = this.selection();
                const info = {
                    id: messageId,
                    sessionID: state.id,
                    role: "user",
                    time: { created: now, updated: now },
                    agent: "build",
                    model: { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" },
                };
                state.messages.push({
                    info,
                    parts: [
                        {
                            id: ocId("text"),
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
                    info,
                });
                break;
            }
            case "session/title": {
                const data = event.data;
                if (data.title) {
                    state.title = data.title;
                    this.pushSessionEvent(state, {
                        type: "session.updated",
                        info: this.legacySessionInfo(state),
                    });
                }
                break;
            }
            default:
                break;
        }
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
    async handle(req, res) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const path = url.pathname;
        const method = req.method ?? "GET";
        process.stderr.write(`[oc-server] ${method} ${path}\n`);
        // 读取 body
        const body = await readBody(req);
        // ── v2 端点 ──
        if (path === "/api/health" && method === "GET") {
            this.sendJson(res, 200, { healthy: true });
            return;
        }
        if (path === "/api/location" && method === "GET") {
            this.sendJson(res, 200, located({ directory: this.opts.directory, project: { id: projectIdOf(this.opts.directory), directory: this.opts.directory } }, this.opts.directory));
            return;
        }
        if (path === "/api/agent" && method === "GET") {
            const agents = [makeAgentInfo("build", "Code generation and editing agent")];
            this.sendJson(res, 200, located(agents, this.opts.directory));
            return;
        }
        if (path === "/api/provider" && method === "GET") {
            const provider = this.legacyProvider();
            this.sendJson(res, 200, located(provider ? [provider] : [], this.opts.directory));
            return;
        }
        if (path === "/api/model" && method === "GET") {
            const provider = this.legacyProvider();
            const models = provider ? Object.values(provider.models).map((m) => ({ id: m.id, providerID: m.providerID, family: m.family, name: m.name })) : [];
            this.sendJson(res, 200, located(models, this.opts.directory));
            return;
        }
        if (path === "/api/integration" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return;
        }
        if (path === "/api/reference" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return;
        }
        if (path === "/api/command" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return;
        }
        if (path === "/api/skill" && method === "GET") {
            this.sendJson(res, 200, located([], this.opts.directory));
            return;
        }
        if (path === "/api/event" && method === "GET") {
            this.sseHeaders(res);
            this.globalSse.add(res);
            res.write(": connected\n\n");
            req.on("close", () => this.globalSse.delete(res));
            return;
        }
        const sessionMatch = path.match(/^\/api\/session\/([^/]+)(?:\/([^/]+))?$/);
        if (sessionMatch) {
            const sessionId = sessionMatch[1];
            const sub = sessionMatch[2];
            if (method === "GET" && !sub) {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
                }
                return;
            }
            if (method === "POST" && !sub) {
                const payload = body ? safeParse(body) : {};
                const id = payload.id ?? ocId("ses");
                const state = this.getOrCreateSession(id, this.opts.directory);
                this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
                return;
            }
            if (method === "POST" && sub === "prompt") {
                const state = this.sessions.get(sessionId) ?? this.getOrCreateSession(sessionId, this.opts.directory);
                const payload = body ? safeParse(body) : {};
                const prompt = payload.prompt;
                const text = typeof prompt === "string" ? prompt : (prompt?.text ?? "");
                if (!text) {
                    this.sendJson(res, 400, { _tag: "InvalidRequestError", message: "empty prompt" });
                    return;
                }
                const admitted = { messageID: ocId("msg"), delivery: "direct" };
                void this.opts
                    .onPrompt(text, { resumeSessionId: state.dshSessionId }, { onSession: (dshId) => this.bindDshSession(state.id, dshId) })
                    .then((dshId) => {
                    if (dshId)
                        this.bindDshSession(state.id, dshId);
                });
                this.sendJson(res, 200, located(admitted, this.opts.directory));
                return;
            }
            if (method === "POST" && sub === "interrupt") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "wait") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "compact") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "GET" && sub === "event") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sseHeaders(res);
                    state.sse.add(res);
                    res.write(": connected\n\n");
                    req.on("close", () => state.sse.delete(res));
                }
                return;
            }
            if (method === "GET" && sub === "message") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    const limit = Number(url.searchParams.get("limit") ?? 50);
                    const messages = state.messages.slice(-limit);
                    this.sendJson(res, 200, located({ data: messages, cursor: {} }, this.opts.directory));
                }
                return;
            }
            if (method === "GET" && sub === "todo") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: [] }, this.opts.directory));
                }
                return;
            }
            if (method === "GET" && sub === "diff") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: [] }, this.opts.directory));
                }
                return;
            }
            if (method === "GET" && sub === "context") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located(state.messages, this.opts.directory));
                }
                return;
            }
            if (method === "GET" && sub === "history") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, located({ data: [], hasMore: false }, this.opts.directory));
                }
                return;
            }
            if (method === "POST" && sub === "agent") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "model") {
                this.sendJson(res, 200, {});
                return;
            }
            this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
            return;
        }
        if (path === "/api/session/active" && method === "GET") {
            const active = {};
            for (const [id, state] of this.sessions) {
                if (state.busy)
                    active[id] = { type: "running" };
            }
            this.sendJson(res, 200, located(active, this.opts.directory));
            return;
        }
        if (path === "/api/session" && method === "GET") {
            const list = Array.from(this.sessions.values()).map((s) => this.infoOf(s));
            this.sendJson(res, 200, located({ data: list, cursor: {} }, this.opts.directory));
            return;
        }
        if (path === "/api/session" && method === "POST") {
            const payload = body ? safeParse(body) : {};
            const id = payload.id ?? ocId("ses");
            const state = this.getOrCreateSession(id, this.opts.directory);
            this.sendJson(res, 200, located(this.infoOf(state), this.opts.directory));
            return;
        }
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
            const provider = this.legacyProvider();
            this.sendJson(res, 200, { providers: provider ? [provider] : [], default: {} });
            return;
        }
        if (path === "/provider" && method === "GET") {
            const provider = this.legacyProvider();
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
                    name: "build",
                    description: "Code generation and editing agent",
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
            const list = Array.from(this.sessions.values()).map((s) => this.legacySession(s));
            this.sendJson(res, 200, list);
            return;
        }
        if (path === "/session" && method === "POST") {
            const payload = body ? safeParse(body) : {};
            const id = payload.id ?? ocId("ses");
            const state = this.getOrCreateSession(id, this.opts.directory);
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
        // 旧 /session/:id/* 子路由
        const legacySessionMatch = path.match(/^\/session\/([^/]+)(?:\/([^/]+))?$/);
        if (legacySessionMatch) {
            const sessionId = legacySessionMatch[1];
            const sub = legacySessionMatch[2];
            if (method === "GET" && !sub) {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, this.legacySession(state));
                }
                return;
            }
            if (method === "GET" && sub === "message") {
                const state = this.sessions.get(sessionId);
                if (this.sessionOr404(state, res)) {
                    this.sendJson(res, 200, state.messages);
                }
                return;
            }
            if (method === "POST" && sub === "message") {
                // 发送消息（旧协议）：body {parts: [{type:"text", text}]}
                const state = this.sessions.get(sessionId) ?? this.getOrCreateSession(sessionId, this.opts.directory);
                const payload = body ? safeParse(body) : {};
                const parts = Array.isArray(payload.parts) ? payload.parts : [];
                const textPart = parts.find((p) => p?.type === "text");
                const text = textPart?.text ?? "";
                if (!text) {
                    this.sendJson(res, 400, { _tag: "BadRequestError", message: "empty message" });
                    return;
                }
                // 用户消息立即落库并推送
                const messageId = ocId("msg");
                const now = Date.now();
                const sel = this.selection();
                const info = {
                    id: messageId,
                    sessionID: state.id,
                    role: "user",
                    time: { created: now, updated: now },
                    agent: "build",
                    model: { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" },
                };
                state.messages.push({
                    info,
                    parts: [{ id: ocId("text"), sessionID: state.id, messageID: messageId, type: "text", text, time: { start: now, end: now } }],
                });
                this.pushSessionEvent(state, { type: "message.updated", info });
                // 触发 DSH agent
                void this.opts
                    .onPrompt(text, { resumeSessionId: state.dshSessionId }, { onSession: (dshId) => this.bindDshSession(state.id, dshId) })
                    .then((dshId) => {
                    if (dshId)
                        this.bindDshSession(state.id, dshId);
                });
                // 响应占位 assistant 消息（TUI 期待 {info, parts}）
                const pendingId = ocId("msg");
                const sel2 = this.selection();
                const placeholder = {
                    id: pendingId,
                    sessionID: state.id,
                    role: "assistant",
                    time: { created: now },
                    agent: "build",
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
                return;
            }
            if (method === "GET" && sub === "todo") {
                this.sendJson(res, 200, []);
                return;
            }
            if (method === "GET" && sub === "diff") {
                this.sendJson(res, 200, { files: [] });
                return;
            }
            if (method === "POST" && sub === "abort") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "summarize") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "command") {
                this.sendJson(res, 200, {});
                return;
            }
            if (method === "POST" && sub === "shell") {
                this.sendJson(res, 200, {});
                return;
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
                return;
            }
            this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
            return;
        }
        // 未实现 → opencode 错误格式
        this.sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
    }
    // ── 响应构造 ─────────────────────────────────────────────────────────────
    infoOf(state) {
        return makeSessionInfo({
            id: state.id,
            directory: state.directory,
            title: state.title,
            agent: "build",
            model: this.selection(),
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
    legacyProvider() {
        const sel = this.selection();
        if (!sel)
            return undefined;
        const model = legacyModelFromV2({ id: sel.id, providerID: sel.providerID, name: sel.id });
        return {
            id: sel.providerID,
            name: sel.providerID,
            source: "config",
            env: [],
            options: {},
            models: { [sel.id]: model },
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
function viewsToLegacyMessages(sessionID, views, sel) {
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
                    agent: "build",
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
                agent: "build",
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