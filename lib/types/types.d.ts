/**
 * opencode 协议类型与常量（兼容层数据模型）。
 *
 * 从 oc-server.ts 拆出：TUI 消息/part 形状、会话状态、agent/权限常量、
 * 文件工具集合等。纯类型与常量，无逻辑，供各模块共享。
 */
import type { ServerResponse } from "node:http";
import type { ModelRef } from "./oc-proto.js";
/** TUI agent 名 → DSH permission preset。 */
export declare const PERMISSION_AGENTS: Record<string, string>;
export declare const DEFAULT_AGENT = "workspace-write";
export declare const AGENT_DESCRIPTIONS: Record<string, string>;
/** DSH preset 名 → TUI agent 名（未知/缺失回退默认）。 */
export declare function agentOfPreset(preset: string | undefined): string;
export interface LegacyTextPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "text";
    text: string;
    time?: {
        start: number;
        end?: number;
    };
}
export interface LegacyReasoningPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "reasoning";
    text: string;
    time?: {
        start: number;
        end?: number;
    };
}
export interface LegacyToolState {
    status: "pending" | "running" | "completed" | "error";
    input?: Record<string, unknown>;
    content?: unknown[];
    result?: unknown;
    error?: string;
    /** 工具完成后的附加信息（question 的 answers 等） */
    metadata?: Record<string, unknown>;
}
export interface LegacyToolPart {
    id: string;
    sessionID: string;
    messageID: string;
    type: "tool";
    tool: string;
    state: LegacyToolState;
    callID?: string;
    time?: {
        start: number;
        end?: number;
    };
}
export type LegacyPart = LegacyTextPart | LegacyReasoningPart | LegacyToolPart;
export interface LegacyMessageInfo {
    id: string;
    sessionID: string;
    role: "user" | "assistant";
    time: {
        created: number;
        updated?: number;
        completed?: number;
    };
    agent: string;
    model: {
        providerID: string;
        modelID: string;
    };
    parentID?: string;
    modelID?: string;
    providerID?: string;
    mode?: string;
    path?: {
        cwd: string;
        root: string;
    };
    cost?: number;
    tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache: {
            read: number;
            write: number;
        };
    };
    finish?: string;
    error?: string;
}
export interface LegacyMessage {
    info: LegacyMessageInfo;
    parts: LegacyPart[];
}
export interface PendingAssistant {
    messageId: string;
    agent: string;
    model: ModelRef;
    startedAt: number;
    /** 所有文本块按创建顺序排列（文本也分块：思考与输出交替时 part 顺序必须
     *  反映真实时间顺序，TUI 按 part id 字典序渲染） */
    textBlocks: Map<string, PendingTextBlock>;
    /** 思考块：key = `${step}:${index}`（DSH 每 step 的 chunk 索引从 0 重新编号）。
     *  一次"思考→输出→再思考→再输出"会产生多个独立块，各自有独立 part id，
     *  避免 TUI 把多次思考合并、且前一块的 completed 状态被后续 delta 覆盖。 */
    reasoningBlocks: Map<string, PendingReasoningBlock>;
    tools: Map<string, PendingTool>;
    finish?: string;
    endedAt?: number;
    /** DSH assistant/message 事件的 usage（token 统计；turn/end 时写入消息 info） */
    tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cacheRead: number;
        cacheWrite: number;
    };
}
/** 一个文本块（text part 的构建态）。 */
export interface PendingTextBlock {
    /** part id（每块独立；id 分配顺序 = 内容出现顺序） */
    partId: string;
    text: string;
    start: number;
    end?: number;
}
/** 一个思考块（reasoning part 的构建态）。 */
export interface PendingReasoningBlock {
    /** part id（每块独立） */
    partId: string;
    text: string;
    start: number;
    end?: number;
}
export interface PendingTool {
    callID: string;
    name: string;
    state: LegacyToolState;
    inputArgs: string;
    createdAt: number;
}
export interface SessionState {
    id: string;
    directory: string;
    /** DSH 会话 id（agent 绑定的 session id；创建后才有） */
    dshSessionId?: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    busy: boolean;
    /** 当前选中的 agent（read-only / workspace-write / full-access；决定下条消息的 preset） */
    currentAgent: string;
    /** 会话当前模型（TUI 模型选择窗口切换；缺省用全局 selection） */
    currentModel?: ModelRef;
    messages: LegacyMessage[];
    /** 当前正在生成的 assistant 消息（增量构建） */
    pending?: PendingAssistant;
    sse: Set<ServerResponse>;
    /** 挂起的审批（permissionID → 决议回调） */
    permissions: Map<string, (outcome: "allowed-once" | "rejected") => void>;
    /** 挂起的用户提问（requestID → 应答回调） */
    questions: Map<string, (answer: unknown) => void>;
    /** 会话 todo 列表（DSH todo/write → opencode Todo；侧边栏 Todo 区） */
    todos: Array<{
        id: string;
        content: string;
        status: string;
        priority: string;
    }>;
    /** 会话修改的文件（工具调用提取；侧边栏 Modified Files 区） */
    diffs: Array<{
        file: string;
        before: string;
        after: string;
        additions: number;
        deletions: number;
    }>;
}
/** 文件修改类工具：arguments 里通常带 path/filePath/file 字段。 */
export declare const FILE_TOOL_NAMES: Set<string>;
/** 推给 TUI 的 SSE 事件（legacy 信封的 payload 部分）。 */
export interface OutgoingEvent {
    type: string;
    properties: unknown;
}
