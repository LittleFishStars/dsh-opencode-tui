/**
 * DSH 事件映射器：DSH session/event → opencode 旧协议事件。
 *
 * 从 oc-server.ts 拆出。职责：
 * - handleDshEvent：把 DSH 事件流（turn/start、assistant/chunk、tool/call、
 *   tool/result、assistant/message、turn/end、user/message …）映射为 TUI
 *   的消息/part/session 事件并推送
 * - handleApproval / handleQuestion：DSH 审批/提问 → TUI 权限/问题对话框
 * - 工具 part 构造与文件 diff 收集（侧边栏 Modified Files）
 *
 * 不持有会话存储本身，通过 SessionStore 访问会话状态与推送。
 */
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionStore } from "./session-store.js";
import { type SessionState } from "./types.js";
export interface DshEventMapperOptions {
    /** 会话级 todo 快照 → opencode Todo（侧边栏 Todo 区） */
    onTodos?: (state: SessionState, todos: Array<{
        content?: string;
        status?: string;
    }>) => void;
    /** 文件修改类工具调用 → 会话 diff 列表（侧边栏 Modified Files 区） */
    onDiff?: (state: SessionState, file: string) => void;
    /** 会话标题缓存（session/title 事件时更新）。 */
    titleCache?: {
        set(dshId: string, title: string, mtime: number): void;
    };
}
export declare class DshEventMapper {
    private store;
    private opts;
    constructor(store: SessionStore, opts?: DshEventMapperOptions);
    /** 由 plugin 在 ctx.on('session/event') 中调用。 */
    handleDshEvent(session: {
        id: string;
        title?: string;
    }, event: SessionEvent): void;
    /** DSH approval/request → opencode permission 对话框；返回决议结果。 */
    handleApproval(dshSessionId: string, request: {
        toolName: string;
        callId?: string;
        reason?: string;
    }): Promise<"allowed-once" | "rejected"> | undefined;
    /** DSH user question → opencode question 对话框；返回应答（labels 按问题顺序）。 */
    handleQuestion(dshSessionId: string, items: Array<{
        id: string;
        question: string;
        detail?: string;
        header?: string;
        options?: Array<{
            label: string;
            description?: string;
        }>;
        multiSelect?: boolean;
    }>): Promise<unknown> | undefined;
    /** 工具 part 构造（DSH 工具状态 → opencode tool part）。 */
    private toolPart;
}
