import type { Context } from "@deepseek-ai/cordis";
import type { Agent, ModelSelection } from "@deepseek-ai/dsh-agent";
export interface AgentManagerOptions {
    /** 模型选择（来自 agentDefaultModel.currentSelection()） */
    selection: ModelSelection;
    cwd: string;
    /** 恢复的会话 id（resume 模式） */
    resumeSessionId?: string;
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
export declare class AgentManager {
    private ctx;
    private opts;
    private owned;
    constructor(ctx: Context, opts: AgentManagerOptions);
    get current(): OwnedAgent | null;
    get agent(): Agent | undefined;
    /** 创建（或恢复）agent，返回是否新建。 */
    ensure(): Promise<OwnedAgent>;
    /** 发送一条用户消息（排队到 next-turn）。 */
    send(text: string): Promise<void>;
    /** 取消当前生成（Esc）。 */
    cancel(): void;
    /** 把当前会话刷到持久层。 */
    flush(): Promise<void>;
    /** 切换到一个已持久化的会话：释放当前 agent，重新 resume。 */
    switchTo(sessionId: string): Promise<OwnedAgent>;
    /** 清除恢复目标：下次 ensure() 创建全新会话。 */
    clearResume(): void;
    /** 释放当前 agent（取消 + 等待停稳），不清空 opts。 */
    release(): Promise<void>;
    /** 插件卸载：释放 + 刷新。 */
    dispose(): Promise<void>;
}
