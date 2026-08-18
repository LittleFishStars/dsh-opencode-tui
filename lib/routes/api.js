import { located, ocId, makeAgentInfo } from "../oc-proto.js";
import { sendJson, safeParse, sseHeaders } from "../http-util.js";
import { AGENT_DESCRIPTIONS, PERMISSION_AGENTS } from "../types.js";
export async function handleApi(ctx, path, method, body, url, req, res) {
    if (path === "/api/health" && method === "GET") {
        sendJson(res, 200, { healthy: true });
        return true;
    }
    if (path === "/api/location" && method === "GET") {
        sendJson(res, 200, located({ directory: ctx.directory, project: { id: ctx.projectId(ctx.directory), directory: ctx.directory } }, ctx.directory));
        return true;
    }
    if (path === "/api/agent" && method === "GET") {
        const agents = [
            makeAgentInfo("workspace-write", AGENT_DESCRIPTIONS["workspace-write"]),
            makeAgentInfo("read-only", AGENT_DESCRIPTIONS["read-only"]),
            makeAgentInfo("full-access", AGENT_DESCRIPTIONS["full-access"]),
        ];
        sendJson(res, 200, located(agents, ctx.directory));
        return true;
    }
    if (path === "/api/provider" && method === "GET") {
        const provider = await ctx.legacyProvider();
        sendJson(res, 200, located(provider ? [provider] : [], ctx.directory));
        return true;
    }
    if (path === "/api/model" && method === "GET") {
        const provider = await ctx.legacyProvider();
        const models = provider ? Object.values(provider.models).map((m) => ({ id: m.id, providerID: m.providerID, family: m.family, name: m.name })) : [];
        sendJson(res, 200, located(models, ctx.directory));
        return true;
    }
    if (path === "/api/integration" && method === "GET") {
        sendJson(res, 200, located([], ctx.directory));
        return true;
    }
    if (path === "/api/reference" && method === "GET") {
        sendJson(res, 200, located([], ctx.directory));
        return true;
    }
    if (path === "/api/command" && method === "GET") {
        sendJson(res, 200, located([], ctx.directory));
        return true;
    }
    if (path === "/api/skill" && method === "GET") {
        sendJson(res, 200, located([], ctx.directory));
        return true;
    }
    if (path === "/api/event" && method === "GET") {
        sseHeaders(res);
        ctx.store.globalSse.add(res);
        res.write(": connected\n\n");
        req.on("close", () => ctx.store.globalSse.delete(res));
        return true;
    }
    const sessionMatch = path.match(/^\/api\/session\/([^/]+)(?:\/([^/]+))?$/);
    if (sessionMatch) {
        const sessionId = sessionMatch[1];
        const sub = sessionMatch[2];
        if (method === "GET")
            await ctx.store.waitHydrate();
        if (method === "GET" && !sub) {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, located(ctx.store.infoOf(state), ctx.directory));
            }
            return true;
        }
        if (method === "POST" && !sub) {
            const payload = body ? safeParse(body) : {};
            const id = payload.id ?? ocId("ses");
            const state = ctx.store.getOrCreateSession(id, ctx.directory);
            // 新会话进 sync.data.session（TUI 的 session 页/侧边栏依赖它）
            ctx.store.touchSession(state);
            sendJson(res, 200, located(ctx.store.infoOf(state), ctx.directory));
            return true;
        }
        if (method === "POST" && sub === "prompt") {
            const state = ctx.store.sessions.get(sessionId) ?? ctx.store.getOrCreateSession(sessionId, ctx.directory);
            const payload = body ? safeParse(body) : {};
            const prompt = payload.prompt;
            const text = typeof prompt === "string" ? prompt : (prompt?.text ?? "");
            if (!text) {
                sendJson(res, 400, { _tag: "InvalidRequestError", message: "empty prompt" });
                return true;
            }
            if (typeof payload.agent === "string" && payload.agent in PERMISSION_AGENTS)
                state.currentAgent = payload.agent;
            ctx.applyRequestModel(state, payload);
            const admitted = { messageID: ocId("msg"), delivery: "direct" };
            ctx.runPrompt(state, text, { preset: PERMISSION_AGENTS[state.currentAgent] });
            sendJson(res, 200, located(admitted, ctx.directory));
            return true;
        }
        if (method === "POST" && sub === "interrupt") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "wait") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "compact") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "GET" && sub === "event") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sseHeaders(res);
                state.sse.add(res);
                res.write(": connected\n\n");
                req.on("close", () => state.sse.delete(res));
            }
            return true;
        }
        if (method === "GET" && sub === "message") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                const limit = Number(url.searchParams.get("limit") ?? 50);
                const messages = state.messages.slice(-limit);
                sendJson(res, 200, located({ data: messages, cursor: {} }, ctx.directory));
            }
            return true;
        }
        if (method === "GET" && sub === "todo") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, located({ data: state.todos }, ctx.directory));
            }
            return true;
        }
        if (method === "GET" && sub === "diff") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, located({ data: state.diffs }, ctx.directory));
            }
            return true;
        }
        if (method === "GET" && sub === "context") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, located(state.messages, ctx.directory));
            }
            return true;
        }
        if (method === "GET" && sub === "history") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, located({ data: [], hasMore: false }, ctx.directory));
            }
            return true;
        }
        if (method === "POST" && sub === "agent") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "model") {
            sendJson(res, 200, {});
            return true;
        }
        sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
        return true;
    }
    if (path === "/api/session/active" && method === "GET") {
        const active = {};
        for (const [id, state] of ctx.store.sessions) {
            if (state.busy)
                active[id] = { type: "running" };
        }
        sendJson(res, 200, located(active, ctx.directory));
        return true;
    }
    if (path === "/api/session" && method === "GET") {
        // 直查 DSH sessionQuery（权威数据源），合并兼容层状态
        const list = await ctx.listSessions(url.searchParams.get("scope"));
        sendJson(res, 200, located({ data: list, cursor: {} }, ctx.directory));
        return true;
    }
    if (path === "/api/session" && method === "POST") {
        const payload = body ? safeParse(body) : {};
        const id = payload.id ?? ocId("ses");
        const state = ctx.store.getOrCreateSession(id, ctx.directory);
        sendJson(res, 200, located(ctx.store.infoOf(state), ctx.directory));
        return true;
    }
    const v2SessionDelete = path.match(/^\/api\/session\/([^/]+)$/);
    if (v2SessionDelete && method === "DELETE") {
        const ok = await ctx.deleteSession(v2SessionDelete[1]);
        sendJson(res, ok ? 200 : 500, located(ok, ctx.directory));
        return true;
    }
    // ── v2 permission reply ──
    const permReply = path.match(/^\/permission\/([^/]+)\/reply$/);
    if (permReply && method === "POST") {
        const requestID = permReply[1];
        const payload = body ? safeParse(body) : {};
        const reply = (payload.reply ?? payload.response);
        // 查找挂起的审批
        for (const state of ctx.store.sessions.values()) {
            const resolve = state.permissions.get(requestID);
            if (resolve) {
                state.permissions.delete(requestID);
                resolve(reply === "reject" ? "rejected" : "allowed-once");
                ctx.store.pushSessionEvent(state, {
                    type: "permission.replied",
                    properties: { sessionID: state.id, permissionID: requestID, response: reply ?? "reject" },
                });
                break;
            }
        }
        sendJson(res, 200, {});
        return true;
    }
    // ── v2 question reply/reject ──
    const qReply = path.match(/^\/question\/([^/]+)\/reply$/);
    if (qReply && method === "POST") {
        const requestID = qReply[1];
        const payload = body ? safeParse(body) : {};
        const answers = Array.isArray(payload.answers) ? payload.answers : [];
        for (const state of ctx.store.sessions.values()) {
            const resolve = state.questions.get(requestID);
            if (resolve) {
                state.questions.delete(requestID);
                resolve(answers);
                ctx.store.pushSessionEvent(state, {
                    type: "question.replied",
                    properties: { sessionID: state.id, requestID, answers },
                });
                break;
            }
        }
        sendJson(res, 200, {});
        return true;
    }
    const qReject = path.match(/^\/question\/([^/]+)\/reject$/);
    if (qReject && method === "POST") {
        const requestID = qReject[1];
        for (const state of ctx.store.sessions.values()) {
            const resolve = state.questions.get(requestID);
            if (resolve) {
                state.questions.delete(requestID);
                resolve({ answers: [] });
                ctx.store.pushSessionEvent(state, {
                    type: "question.rejected",
                    properties: { sessionID: state.id, requestID },
                });
                break;
            }
        }
        sendJson(res, 200, {});
        return true;
    }
    return false;
}
//# sourceMappingURL=api.js.map