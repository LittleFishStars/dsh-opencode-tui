/**
 * Agent 管理：创建 / 恢复 / 发送 / 取消 / 刷新。
 * 驱动方式与 dsh-headless 一致：agents.create / agents.resume + followup + whenIdle。
 */
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
/**
 * 驱动一个 agent。所有 TUI 操作都通过这里，
 * 事件流则由 plugin.ts 里 `session/event` 订阅统一接管。
 */
export class AgentManager {
    ctx;
    opts;
    owned = null;
    constructor(ctx, opts) {
        this.ctx = ctx;
        this.opts = opts;
    }
    get current() {
        return this.owned;
    }
    get agent() {
        return this.owned?.agent;
    }
    /** 创建（或恢复）agent，返回是否新建。 */
    async ensure() {
        if (this.owned)
            return this.owned;
        const agents = this.ctx.get("agents");
        const { selection, cwd } = this.opts;
        if (this.opts.resumeSessionId) {
            const { agent } = await agents.resume({
                resumeSessionId: SessionId(this.opts.resumeSessionId),
                setup: (agentCtx) => {
                    installModelSelection(agentCtx, { current: selection, assembled: void 0 });
                },
            });
            this.owned = {
                agent,
                sessionId: agent.session.id,
                created: false,
            };
        }
        else {
            const { agent } = await agents.create({
                sessionId: SessionId(`session-${randomUUID()}`),
                meta: { cwd },
                agentOptions: {
                    provider: selection.provider,
                    model: selection.model,
                },
                setup: (agentCtx) => {
                    installModelSelection(agentCtx, { current: selection, assembled: void 0 });
                },
            });
            this.owned = {
                agent,
                sessionId: agent.session.id,
                created: true,
            };
        }
        await this.owned.agent.whenIdle();
        return this.owned;
    }
    /** 发送一条用户消息（排队到 next-turn）。 */
    async send(text) {
        const owned = await this.ensure();
        owned.agent.followup(createUserMessage({
            content: [{ type: "text", text }],
            source: { kind: "user" },
        }));
        // 不 await whenIdle —— 事件流驱动 UI，这里只触发
    }
    /** 取消当前生成（Esc）。 */
    cancel() {
        if (!this.owned)
            return;
        this.owned.agent.cancel({ kind: "user" });
    }
    /** 把当前会话刷到持久层。 */
    async flush() {
        if (!this.owned)
            return;
        const sessions = this.ctx.get("sessions");
        if (sessions)
            await sessions.flush(this.owned.agent.session);
    }
    /** 切换到一个已持久化的会话：释放当前 agent，重新 resume。 */
    async switchTo(sessionId) {
        if (this.owned?.sessionId === sessionId)
            return this.owned;
        await this.release();
        this.opts = { ...this.opts, resumeSessionId: sessionId };
        return this.ensure();
    }
    /** 清除恢复目标：下次 ensure() 创建全新会话。 */
    clearResume() {
        this.opts = { ...this.opts, resumeSessionId: undefined };
    }
    /** 释放当前 agent（取消 + 等待停稳），不清空 opts。 */
    async release() {
        if (!this.owned)
            return;
        const owned = this.owned;
        this.owned = null;
        try {
            owned.agent.cancel({ kind: "user" });
            await owned.agent.whenIdle();
        }
        catch {
            /* 释放失败不阻塞 */
        }
    }
    /** 插件卸载：释放 + 刷新。 */
    async dispose() {
        try {
            await this.flush();
        }
        catch {
            /* 忽略刷新失败 */
        }
        await this.release();
    }
}
//# sourceMappingURL=agent.js.map