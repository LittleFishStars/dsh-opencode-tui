/**
 * dsh-opencode-tui 插件入口：把 DSH 会话/Agent/审批/提问能力接进 Ink TUI。
 *
 * 组合要求：dsh-base 之上（agents/sessions/sessionPersistence/
 * agentDefaultModel/sessionQuery/userQuestions/approval 均来自 base 或 preset）。
 */
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import React from "react";
import Schema from "@deepseek-ai/schemastery";
import { render } from "ink";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-session-query";
import "@deepseek-ai/dsh-session-persistence";
import { TuiStore, ApprovalQueue, QuestionQueue, setGlobalStore, setApprovalQueue, setQuestionQueue } from "./store.js";
import { AgentManager } from "./agent.js";
import { applyEvent, projectEvents, foldSessionMeta, } from "./projection.js";
import { loadThemeName, saveThemeName } from "./theme.js";
import { TuiApp } from "./components/App.js";
/** 稳定 Cordis 插件名。 */
const name = "dsh-opencode-tui";
/** 需要的服务。 */
const inject = ["agents", "sessions", "sessionPersistence", "agentDefaultModel", "sessionQuery"];
const Config = Schema.object({
    /** 模型提供方（默认跟随 agentDefaultModel） */
    provider: Schema.string().required(false),
    model: Schema.string().required(false),
    /** 推理强度档位 */
    effort: Schema.string().required(false),
    /** 启动即恢复的会话 id */
    sessionId: Schema.string().required(false),
    /** 全屏（alt screen）模式 */
    fullscreen: Schema.boolean().default(true),
    /** 工作目录（默认 process.cwd()） */
    cwd: Schema.string().required(false),
    /** 初始屏品牌文案 */
    brand: Schema.string().default("dsh ⌬ opencode"),
});
const ALT_SCREEN_ENTER = "\x1b[?1049h";
const ALT_SCREEN_LEAVE = "\x1b[?1049l";
/** 从 cmdlineArgs 解析 --resume <id>。 */
function parseResumeSession(args) {
    if (!args)
        return undefined;
    const idx = args.indexOf("--resume");
    if (idx >= 0 && args[idx + 1])
        return args[idx + 1];
    return undefined;
}
function apply(ctx, config) {
    const store = new TuiStore();
    setGlobalStore(store);
    const approvals = new ApprovalQueue();
    setApprovalQueue(approvals);
    const questions = new QuestionQueue();
    setQuestionQueue(questions);
    const cwd = config.cwd ?? process.cwd();
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const prefsDir = join(dshHome, "dsh-opencode-tui");
    store.setTheme(loadThemeName(prefsDir));
    store.set({ cwd });
    const args = ctx.get("cmdlineArgs");
    const resumeSessionId = config.sessionId ?? parseResumeSession(args?.get());
    const selection = ctx.agentDefaultModel.currentSelection();
    store.setModel({
        provider: config.provider ?? selection.provider,
        model: config.model ?? selection.model,
        reasoning: selection.reasoningEffort,
    });
    const manager = new AgentManager(ctx, {
        selection,
        cwd,
        resumeSessionId,
    });
    // ── 会话元信息（侧边栏/会话列表） ──────────────────────────────────────
    let messagesRef = [];
    let currentSessionId = null;
    const updateSessionMeta = (sessionId, patch) => {
        const sessions = store.getSnapshot().sessions;
        const idx = sessions.findIndex((s) => s.id === sessionId);
        if (idx === -1)
            return;
        const next = [...sessions];
        const prev = next[idx];
        next[idx] = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
        store.setSessions(next);
    };
    const setCurrentMessages = (msgs) => {
        messagesRef = msgs;
        store.setMessages([...msgs]);
    };
    /** 会话列表全量加载（boot / 手动刷新）。 */
    const loadSessions = async () => {
        try {
            const records = await ctx.sessionQuery.listSessions();
            const metas = [];
            const batchSize = 6;
            for (let i = 0; i < records.length; i += batchSize) {
                const batch = records.slice(i, i + batchSize);
                const chunk = await Promise.all(batch.map(async (record) => {
                    const header = record.header;
                    const meta = {
                        id: header.id,
                        title: "",
                        createdAt: header.createdAt,
                        updatedAt: header.createdAt,
                        messageCount: 0,
                        cwd: header.cwd,
                    };
                    try {
                        const inspection = await ctx.sessionPersistence.inspect(header.id);
                        const folded = foldSessionMeta(header.id, header.createdAt, inspection.events);
                        meta.title = folded.title;
                        meta.updatedAt = folded.updatedAt;
                        meta.messageCount = folded.messageCount;
                    }
                    catch {
                        /* 读不到的会话按 header 展示 */
                    }
                    return meta;
                }));
                metas.push(...chunk);
            }
            metas.sort((a, b) => b.updatedAt - a.updatedAt);
            store.setSessions(metas);
        }
        catch (error) {
            store.notify("warn", `Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /** 打开一个会话（resume / 切换）。 */
    const openSession = async (sessionId) => {
        store.beginSessionSwitch(sessionId);
        try {
            const owned = await manager.switchTo(sessionId);
            const session = owned.agent.session;
            const events = session.events;
            setCurrentMessages(projectEvents(events));
            const folded = foldSessionMeta(sessionId, events[0]?.time ?? Date.now(), events);
            store.setCurrentSession(sessionId, folded.title);
            store.setLoadingSession(false);
            store.notify("info", `Resumed session ${sessionId}`);
        }
        catch (error) {
            store.setLoadingSession(false);
            store.setCurrentSession(null, "");
            store.notify("error", `Failed to resume session: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    /** 事件路由：当前会话的消息投影 + 元信息维护 + 忙碌状态。 */
    const onSessionEvent = (session, event) => {
        const sessionId = session.id;
        if (sessionId === currentSessionId) {
            if (applyEvent(messagesRef, event)) {
                store.setMessages([...messagesRef]);
            }
        }
        // 元信息维护
        if (event.type === "session/title") {
            const title = event.data?.title;
            if (title) {
                updateSessionMeta(sessionId, { title, updatedAt: event.time });
                if (sessionId === currentSessionId) {
                    store.setCurrentSession(sessionId, title);
                }
            }
            return;
        }
        if (event.type === "user/message" || event.type === "assistant/message") {
            const isRealUser = event.type === "assistant/message" ||
                event.data.source?.kind === "user";
            if (isRealUser) {
                updateSessionMeta(sessionId, (prev) => ({
                    updatedAt: event.time,
                    messageCount: prev.messageCount + 1,
                }));
            }
            else {
                updateSessionMeta(sessionId, { updatedAt: event.time });
            }
        }
        else if (event.type === "tool/call" ||
            event.type === "tool/result" ||
            event.type === "turn/start" ||
            event.type === "turn/end") {
            updateSessionMeta(sessionId, { updatedAt: event.time });
        }
        // 忙碌状态
        if (sessionId === currentSessionId) {
            if (event.type === "turn/start") {
                store.setWorking({ busy: true, task: "" });
            }
            else if (event.type === "turn/end") {
                store.setWorking({ busy: false, task: "" });
            }
        }
    };
    ctx.on("session/event", onSessionEvent);
    ctx.on("session/created", (session) => {
        // 新会话进入列表（未持久化前标题为空）
        const existing = store.getSnapshot().sessions.some((s) => s.id === session.id);
        if (!existing) {
            store.setSessions([
                { id: session.id, title: "New Session", createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, cwd },
                ...store.getSnapshot().sessions,
            ]);
        }
    });
    // ── 审批 answerer ────────────────────────────────────────────────────────
    ctx.on("approval/request", (req, next) => {
        const owned = manager.current;
        if (owned && String(req.agent.id) === String(owned.agent.id)) {
            return approvals.park(req);
        }
        return next();
    });
    // ── 用户提问 provider（ask_user_question 工具） ─────────────────────────
    let unregisterQuestions;
    const userQuestions = ctx.get("userQuestions");
    if (userQuestions) {
        unregisterQuestions = userQuestions.registerProvider({
            ask: (request) => questions.ask(request),
        });
    }
    // ── 动作实现 ─────────────────────────────────────────────────────────────
    const externalEditor = (current, done) => {
        const editor = process.env.EDITOR || (process.env.VISUAL ?? "nvim");
        const tmpFile = join(tmpdir(), `dsh-msg-${randomUUID()}.md`);
        try {
            writeFileSync(tmpFile, current, "utf8");
        }
        catch {
            store.notify("error", "Failed to write temp file");
            return;
        }
        // 离开 alt screen 让用户编辑
        if (config.fullscreen)
            process.stdout.write(ALT_SCREEN_LEAVE + "\x1b[?25h");
        const child = spawn(editor, [tmpFile], { stdio: "inherit", shell: process.platform === "win32" });
        child.on("exit", (code) => {
            if (config.fullscreen)
                process.stdout.write(ALT_SCREEN_ENTER + "\x1b[?25l");
            if (code !== 0) {
                store.notify("warn", `Editor exited with code ${code}`);
                return;
            }
            try {
                const content = readFileSync(tmpFile, "utf8");
                unlinkSync(tmpFile);
                if (content.trim() === "") {
                    store.notify("warn", "Message is empty");
                    return;
                }
                done(content);
            }
            catch (error) {
                store.notify("error", `Failed to read editor output: ${String(error)}`);
            }
        });
        child.on("error", (error) => {
            if (config.fullscreen)
                process.stdout.write(ALT_SCREEN_ENTER + "\x1b[?25l");
            store.notify("error", `Failed to launch editor ${editor}: ${error.message}`);
        });
    };
    const actions = {
        send: (text) => {
            void (async () => {
                if (manager.current && manager.current.sessionId !== currentSessionId) {
                    // 理论不可达（发送前总有会话）；防御
                    currentSessionId = manager.current.sessionId;
                }
                store.setWorking({ busy: true, task: "" });
                try {
                    await manager.send(text);
                    const owned = manager.current;
                    if (currentSessionId === null || currentSessionId !== owned.sessionId) {
                        currentSessionId = owned.sessionId;
                        messagesRef = [];
                        store.setCurrentSession(owned.sessionId, "New Session");
                        store.setLoadingSession(false);
                        store.setSessions([
                            { id: owned.sessionId, title: "New Session", createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, cwd },
                            ...store.getSnapshot().sessions.filter((s) => s.id !== owned.sessionId),
                        ]);
                    }
                }
                catch (error) {
                    store.setWorking({ busy: false, task: "" });
                    store.notify("error", `Failed to send: ${error instanceof Error ? error.message : String(error)}`);
                }
            })();
        },
        cancel: () => {
            if (manager.current)
                manager.cancel();
        },
        newSession: () => {
            void (async () => {
                try {
                    await manager.release();
                    manager.clearResume();
                    currentSessionId = null;
                    messagesRef = [];
                    store.beginSessionSwitch(null);
                    store.setLoadingSession(false);
                    store.notify("info", "New session");
                }
                catch (error) {
                    store.notify("error", `Failed to start new session: ${String(error)}`);
                }
            })();
        },
        switchSession: (sessionId) => {
            void openSession(sessionId);
        },
        setTheme: (themeName) => {
            store.setTheme(themeName);
            saveThemeName(prefsDir, themeName);
        },
        quit: () => {
            void (async () => {
                try {
                    await manager.flush();
                }
                catch {
                    /* 退出前刷新失败不阻塞 */
                }
                appInstance.unmount();
                if (config.fullscreen)
                    process.stdout.write(ALT_SCREEN_LEAVE + "\x1b[?25h");
                process.stdout.write("\x1b[0m");
                approvals.settleAll("cancelled");
                questions.settleAll();
                unregisterQuestions?.();
                const exit = ctx.get("appExit");
                if (exit)
                    exit(0);
                else
                    process.exit(0);
            })();
        },
        openExternalEditor: externalEditor,
        pickFile: (_prefix, done) => done(""),
        runCommand: (commandId) => {
            switch (commandId) {
                case "new":
                    actions.newSession();
                    break;
                case "resume": {
                    const sessions = store.getSnapshot().sessions;
                    const target = sessions[0];
                    if (target)
                        actions.switchSession(target.id);
                    else
                        store.notify("warn", "No sessions available");
                    break;
                }
                case "compact": {
                    const owned = manager.current;
                    const commands = ctx.get("commands");
                    if (owned && commands && typeof commands.execute === "function") {
                        void commands.execute(owned.agent, "/compact", new AbortController().signal).catch((error) => {
                            store.notify("error", `compact failed: ${error instanceof Error ? error.message : String(error)}`);
                        });
                    }
                    else {
                        store.notify("warn", "No active session to compact");
                    }
                    break;
                }
                case "init": {
                    const prompt = "Please analyze this codebase and create a AGENTS.md file containing:\n" +
                        "1. Build/lint/test commands - especially for running a single test\n" +
                        "2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.\n\n" +
                        "The file you create will be given to agentic coding agents that operate in this repository. " +
                        "Make it about 20 lines long. If there's already an AGENTS.md, improve it.\n" +
                        "If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.";
                    actions.send(prompt);
                    break;
                }
                case "help":
                    store.openDialog("help");
                    break;
                case "theme":
                    store.openDialog("theme");
                    break;
                case "models":
                    store.openDialog("models");
                    break;
                case "quit":
                    store.openDialog("quit");
                    break;
            }
        },
    };
    const commands = [
        { id: "new", title: "New Session", subtitle: "Start a new conversation" },
        { id: "resume", title: "Resume Last", subtitle: "Switch to the most recent session" },
        { id: "compact", title: "Compact Session", subtitle: "Summarize the current session" },
        { id: "init", title: "Initialize Project", subtitle: "Create/Update the AGENTS.md memory file" },
        { id: "help", title: "Help", subtitle: "Show keybindings" },
        { id: "theme", title: "Theme", subtitle: "Switch color theme" },
        { id: "models", title: "Models", subtitle: "Show model selection" },
        { id: "quit", title: "Quit", subtitle: "Exit the TUI" },
    ];
    // ── 渲染 ────────────────────────────────────────────────────────────────
    if (config.fullscreen)
        process.stdout.write(ALT_SCREEN_ENTER + "\x1b[?25l");
    const appInstance = render(React.createElement(TuiApp, {
        actions,
        brand: config.brand,
        commands,
    }), { exitOnCtrlC: false });
    // ── 启动流程 ────────────────────────────────────────────────────────────
    void loadSessions();
    if (resumeSessionId) {
        void openSession(resumeSessionId);
    }
    // ── 进程信号与卸载 ──────────────────────────────────────────────────────
    const onSignal = () => actions.quit();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return () => {
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
        appInstance.unmount();
        if (config.fullscreen)
            process.stdout.write(ALT_SCREEN_LEAVE + "\x1b[?25h");
        approvals.settleAll("cancelled");
        questions.settleAll();
        unregisterQuestions?.();
        void manager.dispose();
    };
}
export { Config, apply, inject, name };
//# sourceMappingURL=plugin.js.map