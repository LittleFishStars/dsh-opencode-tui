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
    /** 已解析的 preset 装配函数（agentCtx → 挂载工具/提示词），无 roster 时为 undefined */
    presetSetup;
    presetResolved = false;
    constructor(ctx, opts) {
        this.ctx = ctx;
        this.opts = opts;
    }
    /** 解析一次 preset（roster 缺失/解析失败 → 无装配，会话照常启动）。 */
    async resolvePresetSetup() {
        if (this.presetResolved)
            return this.presetSetup;
        this.presetResolved = true;
        const presets = this.ctx.get("agentPresets");
        if (!presets)
            return undefined;
        try {
            const resolved = await presets.resolve(this.opts.preset);
            this.presetSetup = async (agentCtx) => {
                await presets.mount(agentCtx, resolved.id);
            };
        }
        catch (error) {
            this.ctx.logger?.warn?.(`dsh-opencode-tui: agent preset ${this.opts.preset ?? "(default)"} unavailable (${error instanceof Error ? error.message : String(error)}) — composing without a preset`);
        }
        return this.presetSetup;
    }
    /** 组装 agent setup：模型选择 + preset 工具装配。 */
    buildSetup(selection) {
        return async (agentCtx) => {
            installModelSelection(agentCtx, { current: selection, assembled: void 0 });
            const preset = await this.resolvePresetSetup();
            if (preset)
                await preset(agentCtx);
        };
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
                setup: this.buildSetup(selection),
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
                setup: this.buildSetup(selection),
            });
            this.owned = {
                agent,
                sessionId: agent.session.id,
                created: true,
            };
        }
        await this.owned.agent.whenIdle();
        await this.applyPermissionPreset(this.owned.agent);
        return this.owned;
    }
    /** 把 TUI 当前 agent 对应的权限 preset 应用到 DSH 会话（幂等：相同则无操作）。 */
    async applyPermissionPreset(agent) {
        const preset = this.opts.permissionPreset;
        if (!preset)
            return;
        const presets = this.ctx.get("permissionPresets");
        if (!presets || !presets.names.includes(preset)) {
            this.ctx.logger?.warn?.(`dsh-opencode-tui: permission preset "${preset}" unavailable — keeping current`);
            return;
        }
        try {
            presets.set(agent.session, preset);
        }
        catch (error) {
            this.ctx.logger?.warn?.(`dsh-opencode-tui: failed to apply permission preset ${preset}: ${error instanceof Error ? error.message : String(error)}`);
        }
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