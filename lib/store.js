const initialSnapshot = {
    sessions: [],
    sessionsLoaded: false,
    currentSessionId: null,
    messages: [],
    currentTitle: "",
    working: { busy: false, task: "", spinFrame: 0 },
    approval: null,
    model: null,
    themeName: "opencode",
    dialogs: {
        quit: false,
        help: false,
        sessions: false,
        commands: false,
        models: false,
        theme: false,
        filepicker: false,
        init: false,
    },
    showSidebar: false,
    notification: null,
    loadingSession: false,
    cwd: process.cwd(),
};
export class TuiStore {
    snapshot = initialSnapshot;
    listeners = new Set();
    /** 通知自动过期定时器 */
    notificationTimer;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    getSnapshot = () => this.snapshot;
    /** 直接 patch 快照（内部工具，用于批量更新）。 */
    set(patch) {
        const next = typeof patch === "function"
            ? { ...this.snapshot, ...patch(this.snapshot) }
            : { ...this.snapshot, ...patch };
        this.snapshot = next;
        this.emit();
    }
    emit() {
        for (const listener of this.listeners)
            listener();
    }
    // ── 会话 ────────────────────────────────────────────────────────────────
    setSessions(sessions, loaded = true) {
        this.set({ sessions, sessionsLoaded: loaded });
    }
    setCurrentSession(sessionId, title) {
        this.set({ currentSessionId: sessionId, currentTitle: title, showSidebar: sessionId !== null });
    }
    setMessages(messages) {
        this.set({ messages });
    }
    setLoadingSession(loading) {
        this.set({ loadingSession: loading });
    }
    /** 会话切换：清空当前消息并进入加载态。 */
    beginSessionSwitch(sessionId) {
        this.set({
            currentSessionId: sessionId,
            messages: [],
            loadingSession: true,
            showSidebar: sessionId !== null,
            currentTitle: "",
        });
    }
    // ── 工作状态 ────────────────────────────────────────────────────────────
    setWorking(working) {
        this.set((prev) => ({ working: { ...prev.working, ...working } }));
    }
    tickSpinner() {
        this.set((prev) => ({
            working: { ...prev.working, spinFrame: prev.working.spinFrame + 1 },
        }));
    }
    // ── 审批 ────────────────────────────────────────────────────────────────
    setApproval(approval) {
        this.set({ approval });
    }
    // ── 模型 ────────────────────────────────────────────────────────────────
    setModel(model) {
        this.set({ model });
    }
    // ── 主题 ────────────────────────────────────────────────────────────────
    setTheme(themeName) {
        this.set({ themeName });
    }
    // ── 对话框 ──────────────────────────────────────────────────────────────
    toggleDialog(name) {
        this.set((prev) => ({
            dialogs: { ...prev.dialogs, [name]: !prev.dialogs[name] },
        }));
    }
    openDialog(name) {
        this.set((prev) => ({
            dialogs: { ...prev.dialogs, [name]: true },
        }));
    }
    closeDialog(name) {
        this.set((prev) => ({
            dialogs: { ...prev.dialogs, [name]: false },
        }));
    }
    closeAllDialogs() {
        this.set((prev) => ({
            dialogs: {
                quit: false,
                help: false,
                sessions: false,
                commands: false,
                models: false,
                theme: false,
                filepicker: false,
                init: false,
            },
        }));
    }
    // ── 通知 ────────────────────────────────────────────────────────────────
    notify(type, message, ttlMs = 4000) {
        if (this.notificationTimer)
            clearTimeout(this.notificationTimer);
        this.set({ notification: { type, message, ttlMs, at: Date.now() } });
        this.notificationTimer = setTimeout(() => {
            this.set({ notification: null });
        }, ttlMs);
    }
    clearNotification() {
        if (this.notificationTimer)
            clearTimeout(this.notificationTimer);
        this.set({ notification: null });
    }
    // ── 杂项 ────────────────────────────────────────────────────────────────
    setSidebar(show) {
        this.set({ showSidebar: show });
    }
}
/** 全局唯一 store 实例（由插件创建并注入）。 */
export let store;
export function setGlobalStore(s) {
    store = s;
}
export function getStore() {
    if (!store)
        throw new Error("TuiStore not initialized");
    return store;
}
export class ApprovalQueue {
    queue = [];
    active = null;
    seq = 0;
    listeners = new Set();
    snapshotCache = null;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    getSnapshot = () => this.snapshotCache;
    /**
     * 挂起一个审批请求，返回会在此队列给出决定时兑现的 promise。
     * abort 信号触发时按协议以 'cancelled' 结算。
     */
    park(req) {
        const done = Promise.withResolvers();
        this.queue.push({ req, resolve: done.resolve });
        this.drain();
        if (req.signal) {
            if (req.signal.aborted) {
                this.withdraw(req);
            }
            else {
                req.signal.addEventListener("abort", () => this.withdraw(req), { once: true });
            }
        }
        return done.promise;
    }
    withdraw(req) {
        const idx = this.queue.findIndex((p) => p.req === req);
        if (idx >= 0) {
            const [parked] = this.queue.splice(idx, 1);
            parked?.resolve("cancelled");
        }
        if (this.active?.req === req) {
            this.active.resolve("cancelled");
            this.active = null;
            this.drain();
        }
        this.rebuild();
    }
    drain() {
        if (this.active)
            return;
        const next = this.queue.shift();
        if (!next) {
            this.rebuild();
            return;
        }
        this.active = next;
        this.rebuild();
    }
    /** 用户决定当前审批。 */
    decide(outcome) {
        const current = this.active;
        if (!current)
            return;
        this.active = null;
        current.resolve(outcome);
        this.drain();
    }
    /** 全部取消（插件卸载 / agent 释放时）。 */
    settleAll(outcome) {
        const list = [...this.queue];
        this.queue = [];
        if (this.active) {
            list.push(this.active);
            this.active = null;
        }
        for (const parked of list)
            parked.resolve(outcome);
        this.rebuild();
    }
    rebuild() {
        const current = this.active;
        let next = null;
        if (current) {
            next = {
                key: `approval-${++this.seq}`,
                toolName: current.req.toolName,
                reason: current.req.reason,
                command: undefined,
            };
        }
        this.snapshotCache = next;
        for (const listener of this.listeners)
            listener();
    }
}
export let approvalQueue;
export function setApprovalQueue(q) {
    approvalQueue = q;
}
export function getApprovalQueue() {
    return approvalQueue;
}
/** 提问队列：一次挂起一个请求，TUI 渲染选项菜单，answer() 结算。 */
export class QuestionQueue {
    queue = [];
    active = null;
    listeners = new Set();
    snapshotCache = null;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    getSnapshot = () => this.snapshotCache;
    ask(request) {
        const done = Promise.withResolvers();
        this.queue.push({ request, resolve: done.resolve });
        this.drain();
        request.signal?.addEventListener("abort", () => this.withdraw(request), { once: true });
        return done.promise;
    }
    withdraw(request) {
        const idx = this.queue.findIndex((p) => p.request === request);
        if (idx >= 0) {
            const [parked] = this.queue.splice(idx, 1);
            parked?.resolve({ answers: [] });
        }
        if (this.active?.request === request) {
            this.active.resolve({ answers: [] });
            this.active = null;
            this.drain();
        }
        this.emit();
    }
    drain() {
        if (this.active)
            return;
        const next = this.queue.shift();
        if (!next) {
            this.emit();
            return;
        }
        this.active = next;
        this.emit();
    }
    /** 用户回答了当前问题。 */
    answer(answer) {
        const current = this.active;
        if (!current)
            return;
        this.active = null;
        current.resolve(answer);
        this.drain();
    }
    /** 清空（插件卸载）。 */
    settleAll() {
        const list = [...this.queue];
        this.queue = [];
        if (this.active) {
            list.push(this.active);
            this.active = null;
        }
        for (const parked of list)
            parked.resolve({ answers: [] });
        this.emit();
    }
    emit() {
        this.snapshotCache = this.active?.request ?? null;
        for (const listener of this.listeners)
            listener();
    }
}
export let questionQueue;
export function setQuestionQueue(q) {
    questionQueue = q;
}
export function getQuestionQueue() {
    return questionQueue;
}
//# sourceMappingURL=store.js.map