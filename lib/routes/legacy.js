import { ocId } from "../oc-proto.js";
import { safeParse, sendJson, sseHeaders } from "../http-util.js";
import { PERMISSION_AGENTS } from "../types.js";
/** 旧协议 /session/:id/* 子路由。返回是否已处理。 */
export async function handleLegacySession(ctx, path, method, body, url, req, res) {
    const legacySessionMatch = path.match(/^\/session\/([^/]+)(?:\/([^/]+))?$/);
    if (legacySessionMatch) {
        const sessionId = legacySessionMatch[1];
        const sub = legacySessionMatch[2];
        if (method === "GET")
            await ctx.store.waitHydrate();
        if (method === "DELETE" && !sub) {
            // 删除会话（会话列表 Ctrl+d）：移除内存状态 + 删 DSH 数据 + 通知 TUI
            const ok = await ctx.deleteSession(sessionId);
            sendJson(res, ok ? 200 : 500, ok);
            return true;
        }
        if (method === "GET" && !sub) {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, ctx.legacySession(state));
            }
            return true;
        }
        if (method === "GET" && sub === "message") {
            const state = ctx.store.sessions.get(sessionId);
            if (ctx.sessionOr404(state, res)) {
                sendJson(res, 200, state.messages);
            }
            return true;
        }
        if (method === "POST" && sub === "message") {
            // 发送消息（旧协议）：body {agent?, model?, parts: [{type:"text", text}]}
            const state = ctx.store.sessions.get(sessionId) ?? ctx.store.getOrCreateSession(sessionId, ctx.directory);
            const payload = body ? safeParse(body) : {};
            if (typeof payload.agent === "string" && payload.agent in PERMISSION_AGENTS)
                state.currentAgent = payload.agent;
            ctx.applyRequestModel(state, payload);
            const parts = Array.isArray(payload.parts) ? payload.parts : [];
            const textPart = parts.find((p) => p?.type === "text");
            const text = textPart?.text ?? "";
            if (!text) {
                sendJson(res, 400, { _tag: "BadRequestError", message: "empty message" });
                return true;
            }
            // 用户消息立即落库并推送
            const messageId = ocId("msg");
            const now = Date.now();
            const sel = ctx.store.sessionModel(state);
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
            ctx.store.pushSessionEvent(state, { type: "message.updated", properties: { info } });
            // 推 part 事件：user 消息文本实时进 TUI 的 parts（否则消息列表里不显示，
            // 只有重启 hydrate 后才有——TUI 的 sync 不会为后续消息重跑）
            ctx.store.pushSessionEvent(state, {
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
            ctx.runPrompt(state, text, { preset: PERMISSION_AGENTS[state.currentAgent] });
            // 响应占位 assistant 消息（TUI 期待 {info, parts}）
            const pendingId = ocId("msg");
            const sel2 = ctx.store.sessionModel(state);
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
            sendJson(res, 200, { info: placeholder, parts: [] });
            return true;
        }
        if (method === "GET" && sub === "todo") {
            const st = ctx.store.sessions.get(sessionId);
            sendJson(res, 200, st ? st.todos : []);
            return true;
        }
        if (method === "GET" && sub === "diff") {
            const st = ctx.store.sessions.get(sessionId);
            sendJson(res, 200, st ? st.diffs : []);
            return true;
        }
        if (method === "POST" && sub === "abort") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "permissions") {
            // POST /session/:id/permissions/:permissionID，body {response: "once"|"always"|"reject"}
            const m2 = path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/);
            if (m2) {
                const state = ctx.store.sessions.get(m2[1]);
                if (!state) {
                    sendJson(res, 404, { _tag: "NotFoundError", message: "Session not found" });
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
                ctx.store.pushSessionEvent(state, {
                    type: "permission.replied",
                    properties: {
                        sessionID: state.id,
                        permissionID,
                        response: response ?? "reject",
                    },
                });
                sendJson(res, 200, {});
                return true;
            }
            sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
            return true;
        }
        if (method === "POST" && sub === "summarize") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "command") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "shell") {
            sendJson(res, 200, {});
            return true;
        }
        if (method === "POST" && sub === "prompt_async") {
            const state = ctx.store.sessions.get(sessionId) ?? ctx.store.getOrCreateSession(sessionId, ctx.directory);
            const payload = body ? safeParse(body) : {};
            const prompt = payload.prompt;
            const text = typeof prompt === "string" ? prompt : (prompt?.text ?? "");
            if (text) {
                void ctx.sendPrompt(text, { resumeSessionId: state.dshSessionId }).then((dshId) => {
                    if (dshId)
                        ctx.bindDshSession(state.id, dshId);
                });
            }
            sendJson(res, 200, { ok: true });
            return true;
        }
        sendJson(res, 404, { _tag: "NotFoundError", message: `no route: ${method} ${path}` });
        return true;
    }
    return false;
}
/** 旧协议杂项路径（/path /project/current /config/providers /session …）。
 *  返回是否已处理。 */
export async function handleLegacyMisc(ctx, path, method, body, url, req, res) {
    if (path === "/path" && method === "GET") {
        sendJson(res, 200, {
            home: "/home",
            state: ctx.directory + "/.oc-state",
            config: ctx.directory + "/.oc-config",
            worktree: ctx.directory,
            directory: ctx.directory,
        });
        return true;
    }
    if (path === "/project/current" && method === "GET") {
        sendJson(res, 200, {
            id: ctx.projectId(ctx.directory),
            worktree: ctx.directory,
            time: { created: Date.now() },
            sandboxes: [],
        });
        return true;
    }
    if (path === "/config/providers" && method === "GET") {
        const provider = await ctx.legacyProvider();
        sendJson(res, 200, { providers: provider ? [provider] : [], default: {} });
        return true;
    }
    if (path === "/provider" && method === "GET") {
        const provider = await ctx.legacyProvider();
        sendJson(res, 200, {
            all: provider ? [provider] : [],
            default: {},
            connected: provider ? [provider.id] : [],
        });
        return true;
    }
    if (path === "/experimental/capabilities" && method === "GET") {
        sendJson(res, 200, { backgroundSubagents: false });
        return true;
    }
    if (path === "/experimental/console" && method === "GET") {
        sendJson(res, 200, { consoleManagedProviders: [], switchableOrgCount: 0 });
        return true;
    }
    if (path === "/experimental/workspace" && method === "GET") {
        sendJson(res, 200, { workspaces: [], current: undefined });
        return true;
    }
    if (path === "/agent" && method === "GET") {
        sendJson(res, 200, [
            {
                name: "workspace-write",
                description: "Write inside the workspace; wider retries require approval",
                mode: "primary",
                builtIn: true,
                permission: { edit: "allow", bash: {} },
                tools: {},
                options: {},
            },
            {
                name: "read-only",
                description: "Read-only sandbox: reads and searches allowed, writes require approval",
                mode: "primary",
                builtIn: true,
                permission: { edit: "allow", bash: {} },
                tools: {},
                options: {},
            },
            {
                name: "full-access",
                description: "Full file access without approval prompts",
                mode: "primary",
                builtIn: true,
                permission: { edit: "allow", bash: {} },
                tools: {},
                options: {},
            },
        ]);
        return true;
    }
    if (path === "/config" && method === "GET") {
        sendJson(res, 200, {});
        return true;
    }
    if (path === "/session" && method === "GET") {
        // 等待历史会话重建完成（否则 hydrate 慢时会话列表为空）
        await ctx.store.waitHydrate();
        // TUI 默认按项目过滤（?scope=project）；这里按工作目录匹配
        const scope = url.searchParams.get("scope");
        const list = Array.from(ctx.store.sessions.values())
            .filter((s) => scope !== "project" || s.directory === ctx.directory)
            .map((s) => ctx.legacySession(s));
        sendJson(res, 200, list);
        return true;
    }
    if (path === "/session" && method === "POST") {
        const payload = body ? safeParse(body) : {};
        const id = payload.id ?? ocId("ses");
        const state = ctx.store.getOrCreateSession(id, ctx.directory);
        // 新会话进 sync.data.session（TUI 的 session 页/侧边栏依赖它）
        ctx.store.touchSession(state);
        sendJson(res, 200, ctx.legacySession(state));
        return true;
    }
    if (path === "/session/status" && method === "GET") {
        sendJson(res, 200, {});
        return true;
    }
    if (path === "/provider/auth" && method === "GET") {
        sendJson(res, 200, {});
        return true;
    }
    if (path === "/vcs" && method === "GET") {
        sendJson(res, 200, { branch: undefined, provider: undefined, repo: undefined });
        return true;
    }
    if (path === "/command" && method === "GET") {
        sendJson(res, 200, []);
        return true;
    }
    if (path === "/lsp" && method === "GET") {
        sendJson(res, 200, []);
        return true;
    }
    if (path === "/mcp" && method === "GET") {
        sendJson(res, 200, {});
        return true;
    }
    if (path === "/experimental/resource" && method === "GET") {
        sendJson(res, 200, {});
        return true;
    }
    if (path === "/formatter" && method === "GET") {
        sendJson(res, 200, []);
        return true;
    }
    if (path === "/global/event" && method === "GET") {
        sseHeaders(res);
        ctx.store.globalSse.add(res);
        res.write(": connected\n\n");
        req.on("close", () => ctx.store.globalSse.delete(res));
        return true;
    }
    return false;
}
//# sourceMappingURL=legacy.js.map