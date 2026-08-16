/**
 * TUI 中央状态：用 useSyncExternalStore 订阅的不可变快照 store。
 * 所有写入都走 TuiStore 方法，最后统一 emit。
 */
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";
import type { MessageView, SessionMeta } from "./projection.js";
export type DialogName = "quit" | "help" | "sessions" | "commands" | "models" | "theme" | "filepicker" | "init";
export interface Notification {
    type: "info" | "warn" | "error";
    message: string;
    ttlMs: number;
    at: number;
}
export interface ApprovalSnapshot {
    key: string;
    toolName: string;
    reason?: string;
    command?: string;
}
export interface WorkingState {
    /** 当前 agent 是否忙碌 */
    busy: boolean;
    /** 忙碌时的状态文案（Thinking.../Generating.../Building tool call.../Waiting for tool response...） */
    task: string;
    /** 转圈帧（由 App 驱动） */
    spinFrame: number;
}
export interface ModelSelectionInfo {
    provider: string;
    model: string;
    reasoning?: string;
}
export interface Snapshot {
    sessions: SessionMeta[];
    /** 会话列表是否加载完成 */
    sessionsLoaded: boolean;
    currentSessionId: string | null;
    messages: MessageView[];
    /** 当前会话的标题（sidebar 用） */
    currentTitle: string;
    working: WorkingState;
    approval: ApprovalSnapshot | null;
    model: ModelSelectionInfo | null;
    themeName: string;
    dialogs: Record<DialogName, boolean>;
    showSidebar: boolean;
    notification: Notification | null;
    /** 事件驱动型转场（如会话切换中） */
    loadingSession: boolean;
    cwd: string;
    /** 折叠块展开状态：`thinking:<key>` / `tool:<key>` → true=展开 */
    expanded: Record<string, boolean>;
    /** 当前打开对话框的屏幕矩形（鼠标命中用） */
    dialogRect: {
        left: number;
        top: number;
        width: number;
        height: number;
    } | null;
}
export declare class TuiStore {
    private snapshot;
    private readonly listeners;
    /** 通知自动过期定时器 */
    private notificationTimer;
    subscribe: (listener: () => void) => (() => void);
    getSnapshot: () => Snapshot;
    /** 直接 patch 快照（内部工具，用于批量更新）。 */
    set(patch: Partial<Snapshot> | ((prev: Snapshot) => Partial<Snapshot>)): void;
    private emit;
    setSessions(sessions: SessionMeta[], loaded?: boolean): void;
    setCurrentSession(sessionId: string | null, title: string): void;
    setMessages(messages: MessageView[]): void;
    setLoadingSession(loading: boolean): void;
    /** 会话切换：清空当前消息并进入加载态。 */
    beginSessionSwitch(sessionId: string | null): void;
    setWorking(working: Partial<WorkingState>): void;
    tickSpinner(): void;
    setApproval(approval: ApprovalSnapshot | null): void;
    setModel(model: ModelSelectionInfo | null): void;
    setTheme(themeName: string): void;
    toggleDialog(name: DialogName): void;
    openDialog(name: DialogName): void;
    closeDialog(name: DialogName): void;
    closeAllDialogs(): void;
    notify(type: Notification["type"], message: string, ttlMs?: number): void;
    clearNotification(): void;
    setSidebar(show: boolean): void;
    /** 切换某个折叠块（thinking:<key> / tool:<key>）。 */
    toggleExpanded(id: string): void;
    isExpanded(id: string): boolean;
    /** 对话框组件渲染时报告自己的屏幕矩形（供鼠标命中换算）。 */
    setDialogRect(rect: {
        left: number;
        top: number;
        width: number;
        height: number;
    } | null): void;
}
/** 全局唯一 store 实例（由插件创建并注入）。 */
export declare let store: TuiStore | undefined;
export declare function setGlobalStore(s: TuiStore): void;
export declare function getStore(): TuiStore;
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
export declare let approvalQueue: ApprovalQueue | undefined;
export declare function setApprovalQueue(q: ApprovalQueue): void;
export declare function getApprovalQueue(): ApprovalQueue | undefined;
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from "@deepseek-ai/dsh-user-questions";
/** 提问队列：一次挂起一个请求，TUI 渲染选项菜单，answer() 结算。 */
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
export declare let questionQueue: QuestionQueue | undefined;
export declare function setQuestionQueue(q: QuestionQueue): void;
export declare function getQuestionQueue(): QuestionQueue | undefined;
