/**
 * dsh-opencode-bridge：stdio JSONL 桥插件。
 *
 * 供 opencode fork 的 Go 中间层驱动：Go 子进程拉起本插件（dsh --profile
 * opencode-bridge），通过 stdin/stdout 的 JSONL 协议完成
 * 会话/消息/生成/审批/提问的全部交互。UI 完全由 opencode TUI 负责。
 *
 * 协议（每行一个 JSON）：
 *   Go → DSH : {"id":1,"method":"...","params":{...}}
 *   DSH → Go : {"id":1,"result":...} | {"id":1,"error":{...}}
 *               {"event":"...", ...}
 */
import { createInterface } from "node:readline";
import Schema from "@deepseek-ai/schemastery";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-session-query";
import "@deepseek-ai/dsh-session-persistence";
import { AgentManager } from "./agent.js";
import { applyEvent, projectEvents, foldSessionMeta } from "./projection.js";
import { ApprovalQueue, QuestionQueue } from "./store.js";
const name = "dsh-opencode-bridge";
const inject = ["agents", "sessions", "sessionPersistence", "agentDefaultModel", "sessionQuery"];
const Config = Schema.object({
    provider: Schema.string().required(false),
    model: Schema.string().required(false),
    preset: Schema.string().required(false),
    cwd: Schema.string().required(false),
});
function mapReason(kind) {
    switch (kind) {
        case "completed":
            return "end_turn";
        case "aborted":
        case "interrupted":
            return "canceled";
        case "max-tokens":
            return "max_tokens";
        case "error":
            return "error";
        default:
            return "end_turn";
    }
}
/** 默认模型名（assistant 消息缺省时回退；由 model.get 更新）。 */
let defaultModel = "";
/** 把 DSH 消息视图聚合为桥消息（tool 卡归入其前的 assistant 消息）。 */
function aggregate(views) {
    const out = [];
    let cur = null;
    for (const v of views) {
        if (v.kind === "user") {
            cur = null;
            out.push({
                id: v.id,
                role: "user",
                content: v.content,
                thinking: "",
                model: "",
                createdAt: v.time,
                updatedAt: v.time,
                toolCalls: [],
                toolResults: [],
            });
        }
        else if (v.kind === "assistant") {
            cur = {
                id: v.id,
                role: "assistant",
                content: v.text,
                thinking: v.thinking,
                model: v.model ?? defaultModel,
                createdAt: v.time,
                updatedAt: v.time,
                toolCalls: [],
                toolResults: [],
                finish: v.finished && v.endedAt !== undefined
                    ? { reason: mapReason(v.reason), time: v.endedAt }
                    : undefined,
            };
            out.push(cur);
        }
        else {
            // tool 卡 → 归入当前 assistant 消息
            if (cur) {
                cur.toolCalls.push({
                    id: v.tool.id,
                    name: v.tool.name,
                    input: v.tool.arguments,
                    finished: v.tool.status !== "running",
                });
                if (v.tool.status !== "running") {
                    cur.toolResults.push({
                        toolCallId: v.tool.id,
                        name: v.tool.name,
                        content: v.tool.result ?? "",
                        isError: v.tool.status === "error",
                    });
                }
                cur.updatedAt = Math.max(cur.updatedAt, v.time);
            }
        }
    }
    return out;
}
function apply(ctx, config) {
    const approvals = new ApprovalQueue();
    const questions = new QuestionQueue();
    // ── stdio 协议 ───────────────────────────────────────────────────────────
    const pending = new Map();
    let seq = 0;
    const send = (obj) => {
        process.stdout.write(JSON.stringify(obj) + "\n");
    };
    const respond = (id, result) => send({ id, result });
    const fail = (id, message, code = "ERROR") => send({ id, error: { code, message } });
    const emit = (event, payload) => send({ event, ...payload });
    const cwd = config.cwd ?? process.cwd();
    const selection = ctx.agentDefaultModel.currentSelection();
    const manager = new AgentManager(ctx, {
        selection,
        cwd,
        preset: config.preset ?? process.env.DSH_OPENCODE_TUI_PRESET,
    });
    const sessions = new Map();
    defaultModel = config.model ?? selection.model;
    const getSession = (sessionId) => {
        let s = sessions.get(sessionId);
        if (!s) {
            s = { id: sessionId, title: "", createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, busy: false, views: [], messages: [] };
            sessions.set(sessionId, s);
        }
        return s;
    };
    /** 重聚合并推送变化消息。节流调用方负责。 */
    const republish = (sessionId) => {
        const s = getSession(sessionId);
        const next = aggregate(s.views);
        const oldById = new Map(s.messages.map((m) => [m.id, JSON.stringify(m)]));
        for (const m of next) {
            if (oldById.get(m.id) !== JSON.stringify(m)) {
                emit("message/updated", { sessionId, message: m });
            }
        }
        const oldIds = new Set(oldById.keys());
        for (const m of next) {
            if (!oldIds.has(m.id))
                emit("message/created", { sessionId, message: m });
        }
        s.messages = next;
    };
    /** chunk 类事件的节流重聚合（30ms 合并）。 */
    let republishTimer;
    const scheduleRepublish = (sessionId) => {
        if (republishTimer)
            return;
        republishTimer = setTimeout(() => {
            republishTimer = undefined;
            republish(sessionId);
        }, 30);
    };
    // ── DSH 事件订阅 ─────────────────────────────────────────────────────────
    ctx.on("session/event", (session, event) => {
        const s = getSession(session.id);
        const changed = applyEvent(s.views, event);
        s.updatedAt = Math.max(s.updatedAt, event.time);
        if (event.type === "user/message" || event.type === "assistant/message") {
            s.messageCount += 1;
        }
        if (event.type === "turn/start") {
            s.busy = true;
            emit("agent/start", { sessionId: session.id });
        }
        else if (event.type === "turn/end") {
            s.busy = false;
            const reason = mapReason(event.data.reason?.kind);
            emit("agent/done", { sessionId: session.id, reason, time: event.time });
        }
        if (!changed) {
            if (event.type === "session/title") {
                const title = event.data?.title;
                if (title) {
                    s.title = title;
                    emit("session/title", { sessionId: session.id, title });
                }
            }
            return;
        }
        if (event.type === "assistant/chunk" || event.type === "assistant/message") {
            scheduleRepublish(session.id);
        }
        else {
            republish(session.id);
        }
    });
    // ── 审批 / 提问 ──────────────────────────────────────────────────────────
    ctx.on("approval/request", (req, next) => {
        const owned = manager.current;
        if (owned && String(req.agent.id) === String(owned.agent.id)) {
            const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            emit("approval/request", {
                id,
                sessionId: owned.sessionId,
                toolName: req.toolName,
                reason: req.reason ?? "",
            });
            const outcome = approvals.park(req);
            // 结果回传：approval.decide 方法会调用 approvals.decide
            void outcome.then((o) => emit("approval/resolved", { id, outcome: o }));
            return outcome;
        }
        return next();
    });
    const userQuestions = ctx.get("userQuestions");
    let unregisterQuestions;
    if (userQuestions) {
        unregisterQuestions = userQuestions.registerProvider({
            ask: (request) => {
                const id = `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                emit("question/request", { id, questions: request.questions });
                return questions.ask(request);
            },
        });
    }
    // ── 会话列表加载（供 session.list） ──────────────────────────────────────
    const loadPersistedSessions = async () => {
        try {
            const records = await ctx.sessionQuery.listSessions();
            for (const record of records) {
                const header = record.header;
                try {
                    const inspection = await ctx.sessionPersistence.inspect(header.id);
                    const folded = foldSessionMeta(header.id, header.createdAt, inspection.events);
                    const s = getSession(header.id);
                    s.title = folded.title;
                    s.createdAt = folded.createdAt;
                    s.updatedAt = folded.updatedAt;
                    s.messageCount = folded.messageCount;
                    s.views = projectEvents(inspection.events);
                    s.messages = aggregate(s.views);
                }
                catch {
                    /* 读不到的会话按 header 展示 */
                }
            }
        }
        catch {
            /* 列表加载失败不致命 */
        }
    };
    // ── 方法分发 ─────────────────────────────────────────────────────────────
    const handlers = {
        "session.create": async (params) => {
            const owned = await manager.ensure();
            const s = getSession(owned.sessionId);
            s.title = params.title ?? "New Session";
            return {
                id: owned.sessionId,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messageCount: s.messageCount,
            };
        },
        "session.list": async () => {
            await loadPersistedSessions();
            return [...sessions.values()].map((s) => ({
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messageCount: s.messageCount,
                busy: s.busy,
            }));
        },
        "session.get": async (params) => {
            const id = String(params.id);
            await loadPersistedSessions();
            const s = getSession(id);
            return {
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                messageCount: s.messageCount,
                busy: s.busy,
            };
        },
        "session.delete": async (params) => {
            sessions.delete(String(params.id));
            return true;
        },
        "messages.list": async (params) => {
            const id = String(params.sessionId);
            await loadPersistedSessions();
            const s = getSession(id);
            s.messages = aggregate(s.views);
            return s.messages;
        },
        "agent.run": async (params) => {
            const sessionId = String(params.sessionId);
            const text = String(params.text ?? "");
            const s = getSession(sessionId);
            // 若 manager 当前不在该会话，切换（resume）
            if (manager.current?.sessionId !== sessionId) {
                await manager.switchTo(sessionId);
            }
            s.busy = true;
            emit("agent/start", { sessionId });
            await manager.send(text);
            return true;
        },
        "agent.cancel": async (params) => {
            if (manager.current?.sessionId === String(params.sessionId)) {
                manager.cancel();
            }
            return true;
        },
        "agent.busy": async (params) => {
            const id = String(params.sessionId);
            return getSession(id).busy || (manager.current?.sessionId === id && false);
        },
        "agent.summarize": async (params) => {
            const id = String(params.sessionId);
            const commands = ctx.get("commands");
            const owned = manager.current;
            if (owned && owned.sessionId === id && commands && typeof commands.execute === "function") {
                await commands.execute(owned.agent, "/compact", new AbortController().signal);
                return true;
            }
            throw new Error("no active session to summarize");
        },
        "model.get": async () => {
            const sel = ctx.agentDefaultModel.currentSelection();
            defaultModel = config.model ?? sel.model;
            return {
                provider: config.provider ?? sel.provider,
                model: defaultModel,
                reasoningEffort: sel.reasoningEffort,
            };
        },
        "approval.decide": async (params) => {
            const outcome = String(params.outcome);
            approvals.decide(outcome);
            return true;
        },
        "question.answer": async (params) => {
            const answer = params.answers;
            questions.answer(answer);
            return true;
        },
    };
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
        if (line.trim() === "")
            return;
        let req;
        try {
            req = JSON.parse(line);
        }
        catch {
            return;
        }
        if (req.id === undefined || !req.method)
            return;
        const handler = handlers[req.method];
        if (!handler) {
            fail(req.id, `unknown method: ${req.method}`, "UNKNOWN_METHOD");
            return;
        }
        void Promise.resolve(handler(req.params ?? {}))
            .then((result) => respond(req.id, result))
            .catch((error) => fail(req.id, error instanceof Error ? error.message : String(error)));
    });
    // 启动：会话列表预热 + 汇报就绪
    void loadPersistedSessions().then(() => {
        emit("ready", {});
    });
    return () => {
        unregisterQuestions?.();
        approvals.settleAll("cancelled");
        questions.settleAll();
        void manager.dispose();
    };
}
export { Config, apply, inject, name };
//# sourceMappingURL=bridge.js.map