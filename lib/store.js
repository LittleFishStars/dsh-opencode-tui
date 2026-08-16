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
/** 提问队列：一次挂起一个请求，answer() 结算。 */
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
//# sourceMappingURL=store.js.map