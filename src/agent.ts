/**
 * Agent 管理：创建 / 恢复 / 发送 / 取消 / 刷新。
 * 驱动方式与 dsh-headless 一致：agents.create / agents.resume + followup + whenIdle。
 */
import { randomUUID } from "node:crypto";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentHandle, ModelSelection } from "@deepseek-ai/dsh-agent";
import type { AgentPresets } from "@deepseek-ai/dsh-agent-presets";

export interface AgentManagerOptions {
  /** 模型选择（来自 agentDefaultModel.currentSelection()） */
  selection: ModelSelection;
  cwd: string;
  /** 恢复的会话 id（resume 模式） */
  resumeSessionId?: string;
  /** agent preset id（默认取 roster 的 default；undefined = roster 默认） */
  preset?: string;
  /** 权限 preset（read-only / workspace-write / danger-full-access；来自 TUI 当前 agent） */
  permissionPreset?: string;
  /** TUI 模型选择窗口切换的模型（覆盖 selection） */
  model?: { providerID: string; id: string };
}

export interface OwnedAgent {
  agent: Agent;
  sessionId: string;
  /** 是否本次进程新建（false = resume） */
  created: boolean;
}

/**
 * 驱动一个 agent。所有 TUI 操作都通过这里，
 * 事件流则由 plugin.ts 里 `session/event` 订阅统一接管。
 */
export class AgentManager {
  private ctx: Context;
  private opts: AgentManagerOptions;
  private owned: OwnedAgent | null = null;
  /** 已解析的 preset 装配函数（agentCtx → 挂载工具/提示词），无 roster 时为 undefined */
  private presetSetup: ((agentCtx: Context) => Promise<void>) | undefined;
  private presetResolved = false;

  constructor(ctx: Context, opts: AgentManagerOptions) {
    this.ctx = ctx;
    this.opts = opts;
  }

  /** 解析一次 preset（roster 缺失/解析失败 → 无装配，会话照常启动）。 */
  private async resolvePresetSetup(): Promise<((agentCtx: Context) => Promise<void>) | undefined> {
    if (this.presetResolved) return this.presetSetup;
    this.presetResolved = true;
    const presets = this.ctx.get("agentPresets") as AgentPresets | undefined;
    if (!presets) return undefined;
    try {
      const resolved = await presets.resolve(this.opts.preset);
      this.presetSetup = async (agentCtx: Context) => {
        await presets.mount(agentCtx, resolved.id);
      };
    } catch (error) {
      this.ctx.logger?.warn?.(
        `dsh-opencode-tui: agent preset ${this.opts.preset ?? "(default)"} unavailable (${error instanceof Error ? error.message : String(error)}) — composing without a preset`,
      );
    }
    return this.presetSetup;
  }

  /** 组装 agent setup：模型选择 + preset 工具装配。 */
  private buildSetup(selection: ModelSelection): (agentCtx: Context) => Promise<void> {
    return async (agentCtx: Context) => {
      installModelSelection(agentCtx, { current: selection, assembled: void 0 });
      const preset = await this.resolvePresetSetup();
      if (preset) await preset(agentCtx);
    };
  }

  /** 生效的模型选择：TUI 切换的模型优先，否则默认 selection。 */
  private effectiveSelection(): ModelSelection {
    const override = this.opts.model;
    if (override?.providerID && override.id) {
      return { provider: override.providerID, model: override.id };
    }
    return this.opts.selection;
  }

  get current(): OwnedAgent | null {
    return this.owned;
  }

  get agent(): Agent | undefined {
    return this.owned?.agent;
  }

  /** 创建（或恢复）agent，返回是否新建。 */
  async ensure(): Promise<OwnedAgent> {
    if (this.owned) return this.owned;
    const agents = this.ctx.get("agents")!;
    const { selection, cwd } = this.opts;
    const effective = this.effectiveSelection();
    if (this.opts.resumeSessionId) {
      const { agent } = await agents.resume({
        resumeSessionId: SessionId(this.opts.resumeSessionId),
        setup: this.buildSetup(effective),
      });
      this.owned = {
        agent,
        sessionId: agent.session.id,
        created: false,
      };
    } else {
      const { agent } = await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd },
        agentOptions: {
          provider: effective.provider,
          model: effective.model,
        },
        setup: this.buildSetup(effective),
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
  private async applyPermissionPreset(agent: Agent): Promise<void> {
    const preset = this.opts.permissionPreset;
    if (!preset) return;
    const presets = this.ctx.get("permissionPresets") as
      | { names: readonly string[]; set(session: unknown, name: string): void }
      | undefined;
    if (!presets || !presets.names.includes(preset)) {
      this.ctx.logger?.warn?.(`dsh-opencode-tui: permission preset "${preset}" unavailable — keeping current`);
      return;
    }
    try {
      presets.set(agent.session, preset);
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-opencode-tui: failed to apply permission preset ${preset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 发送一条用户消息（排队到 next-turn）。 */
  async send(text: string): Promise<void> {
    const owned = await this.ensure();
    owned.agent.followup(
      createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "user" },
      }),
    );
    // 不 await whenIdle —— 事件流驱动 UI，这里只触发
  }

  /** 取消当前生成（Esc）。 */
  cancel(): void {
    if (!this.owned) return;
    this.owned.agent.cancel({ kind: "user" });
  }

  /** 把当前会话刷到持久层。 */
  async flush(): Promise<void> {
    if (!this.owned) return;
    const sessions = this.ctx.get("sessions");
    if (sessions) await sessions.flush(this.owned.agent.session);
  }

  /** 切换到一个已持久化的会话：释放当前 agent，重新 resume。 */
  async switchTo(sessionId: string): Promise<OwnedAgent> {
    if (this.owned?.sessionId === sessionId) return this.owned;
    await this.release();
    this.opts = { ...this.opts, resumeSessionId: sessionId };
    return this.ensure();
  }

  /** 清除恢复目标：下次 ensure() 创建全新会话。 */
  clearResume(): void {
    this.opts = { ...this.opts, resumeSessionId: undefined };
  }

  /** 释放当前 agent（取消 + 等待停稳），不清空 opts。 */
  async release(): Promise<void> {
    if (!this.owned) return;
    const owned = this.owned;
    this.owned = null;
    try {
      owned.agent.cancel({ kind: "user" });
      await owned.agent.whenIdle();
    } catch {
      /* 释放失败不阻塞 */
    }
  }

  /** 插件卸载：释放 + 刷新。 */
  async dispose(): Promise<void> {
    try {
      await this.flush();
    } catch {
      /* 忽略刷新失败 */
    }
    await this.release();
  }
}
