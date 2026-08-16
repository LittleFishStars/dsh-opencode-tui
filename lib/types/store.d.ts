/**
 * 桥插件共享状态：审批与提问队列（纯逻辑，无 UI 依赖）。
 */
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";
export interface ApprovalSnapshot {
    key: string;
    toolName: string;
    reason?: string;
    command?: string;
}
export declare class ApprovalQueue {
    private queue;
    private active;
    private seq;
    private readonly listeners;
    private snapshotCache;
    subscribe: (listener: () => void) => (() => void);
    getSnapshot: () => ApprovalSnapshot | null;
    /**
     * 挂起一个审批请求，返回会在此队列给出决定时兑现的 promise。
     * abort 信号触发时按协议以 'cancelled' 结算。
     */
    park(req: ApprovalRequest): Promise<ApprovalOutcome>;
    private withdraw;
    private drain;
    /** 用户决定当前审批。 */
    decide(outcome: "allowed-once" | "rejected"): void;
    /** 全部取消（插件卸载 / agent 释放时）。 */
    settleAll(outcome: ApprovalOutcome): void;
    private rebuild;
}
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from "@deepseek-ai/dsh-user-questions";
/** 提问队列：一次挂起一个请求，answer() 结算。 */
export declare class QuestionQueue {
    private queue;
    private active;
    private listeners;
    private snapshotCache;
    subscribe: (listener: () => void) => (() => void);
    getSnapshot: () => AskUserQuestionRequest | null;
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
    private withdraw;
    private drain;
    /** 用户回答了当前问题。 */
    answer(answer: AskUserQuestionAnswer): void;
    /** 清空（插件卸载）。 */
    settleAll(): void;
    private emit;
}
