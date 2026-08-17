/**
 * 会话事件日志 → TUI 消息视图的投影。
 *
 * 同时支持两种输入：
 * - 全量回放（resume 时 `persistence.inspect(id)` 的完整 events 数组）
 * - 增量订阅（`session/event` 的单个事件）
 *
 * 事件词汇见 @deepseek-ai/dsh-session 的 SessionEventMap。
 */
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { LegacyMessage } from "./types.js";
export interface ToolCallView {
    /** callId */
    id: string;
    name: string;
    /** 模型产出的原始 JSON 参数串 */
    arguments: string;
    status: "running" | "done" | "error";
    /** 结果文本（拼接 message.content 的 text 块） */
    result?: string;
    /** 结构化失败信息 */
    error?: {
        name: string;
        code: string;
    };
    startedAt: number;
    endedAt?: number;
}
export interface UserMessageView {
    kind: "user";
    /** 事件 seq（排序/去重用） */
    seq: number;
    time: number;
    /** 拼接后的文本 */
    content: string;
    /** 消息 id */
    id: string;
}
export interface AssistantMessageView {
    kind: "assistant";
    seq: number;
    /** 当前 step 起始事件 seq（assistant 卡片的标识） */
    id: string;
    time: number;
    /** 流式累积/最终文本 */
    text: string;
    /** 思考（reasoning）文本（旧字段，全部块拼接；新代码用 contentBlocks） */
    thinking: string;
    /** 内容块（text/reasoning 交错出现，按事件顺序排列；思考/输出交替时
     *  保持 part 顺序，多次思考各自独立不合并）。旧会话无此字段时回退 thinking/text。 */
    contentBlocks?: Array<{
        kind: "text" | "reasoning";
        key: string;
        text: string;
    }>;
    /** assistant/message 已落地（模型回复完成，可能仍在跑工具） */
    assembled: boolean;
    /** turn/end 已到达 */
    finished: boolean;
    /** turn/end reason kind */
    reason?: string;
    model?: string;
    provider?: string;
    endedAt?: number;
    /** 是否本轮没有文本输出（纯工具轮） */
    empty?: boolean;
}
export interface ToolMessageView {
    kind: "tool";
    seq: number;
    time: number;
    tool: ToolCallView;
}
export type MessageView = UserMessageView | AssistantMessageView | ToolMessageView;
export interface SessionMeta {
    id: string;
    /** session/title 事件折叠出的标题；无则从首条用户消息兜底 */
    title: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    cwd?: string;
    /** 最近一次 permission/preset 事件记录的 preset 名（read-only / workspace-write / danger-full-access） */
    preset?: string;
}
/**
 * 增量投影：把单个会话事件应用到消息列表上。
 * 返回是否产生了可见变化。
 */
export declare function applyEvent(messages: MessageView[], event: SessionEvent): boolean;
/** 全量回放：把事件数组折叠成消息列表。 */
export declare function projectEvents(events: readonly SessionEvent[]): MessageView[];
/** 从事件日志提取会话标题（最后一个 session/title 事件）。 */
export declare function titleFromEvents(events: readonly SessionEvent[]): string | undefined;
/** 从事件日志统计消息数量 + 最后活跃时间。 */
export declare function sessionStats(events: readonly SessionEvent[]): {
    updatedAt: number;
    messageCount: number;
};
/**
 * 折叠一个会话的元信息（供侧边栏/会话列表）。
 * @param events 该会话的完整事件日志
 * @param fallbackFromFirstUser 没有标题时用首条用户消息兜底
 */
export declare function foldSessionMeta(id: string, createdAt: number, events: readonly SessionEvent[]): SessionMeta;
/** 从会话事件流提取最后一条 todo 快照（opencode Todo 形状）。 */
export declare function todosFromEvents(events: readonly SessionEvent[]): Array<{
    id: string;
    content: string;
    status: string;
    priority: string;
}>;
/** 从会话事件流提取修改过的文件（工具调用 → Modified Files 区）。 */
export declare function diffsFromEvents(events: readonly SessionEvent[]): Array<{
    file: string;
    before: string;
    after: string;
    additions: number;
    deletions: number;
}>;
/**
 * MessageView[] → 旧协议消息列表（user/assistant/tool 卡）。
 * 供会话 hydrate（重启恢复）时把投影视图转成 TUI 能消费的消息形状。
 */
export declare function viewsToLegacyMessages(sessionID: string, views: readonly MessageView[], sel: {
    providerID?: string;
    id?: string;
} | undefined, agent: string): LegacyMessage[];
