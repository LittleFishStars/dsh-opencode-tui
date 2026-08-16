/** 生成 opencode 风格 id：ses_ / msg_ / evt_ 前缀 + 递增 base36（保证排序稳定）。 */
export declare function ocId(prefix: "ses" | "msg" | "evt" | "text" | "reasoning" | "call"): string;
export interface LocationRef {
    directory: string;
    workspaceID?: string;
}
export interface LocationInfo {
    directory: string;
    workspaceID?: string;
    project: {
        id: string;
        directory: string;
    };
}
/** v2 端点响应包装：{ location, data } */
export interface LocatedResponse<T> {
    location: LocationInfo;
    data: T;
}
export declare function located<T>(data: T, directory: string): LocatedResponse<T>;
export declare function locationInfo(directory: string): LocationInfo;
/** project id：fork 用 git 根目录的 sha1，这里用 cwd 的 sha1 近似（稳定性足够）。 */
export declare function projectId(directory: string): string;
export interface SessionInfo {
    id: string;
    parentID?: string;
    projectID: string;
    agent?: string;
    model?: ModelRef;
    cost: number;
    tokens: TokenUsage;
    time: {
        created: number;
        updated: number;
        archived?: number;
    };
    title: string;
    location: LocationRef;
    subpath?: string;
}
export interface TokenUsage {
    input: number;
    output: number;
    reasoning: number;
    cache: {
        read: number;
        write: number;
    };
}
export interface ModelRef {
    id: string;
    providerID: string;
    variant?: string;
}
export declare function makeSessionInfo(init: {
    id: string;
    directory: string;
    title?: string;
    agent?: string;
    model?: ModelRef;
    created?: number;
    updated?: number;
}): SessionInfo;
export interface MessageBase {
    id: string;
    time: {
        created: number;
    };
}
export interface UserMessage extends MessageBase {
    type: "user";
    text: string;
    files?: unknown[];
    agents?: unknown[];
}
export interface AssistantTextPart {
    type: "text";
    id: string;
    text: string;
}
export interface AssistantReasoningPart {
    type: "reasoning";
    id: string;
    text: string;
}
export interface ToolState {
    status: "pending" | "running" | "completed" | "error";
    input: Record<string, unknown>;
    content: unknown[];
    structured: Record<string, unknown>;
    error?: {
        type: "unknown";
        message: string;
    };
    result?: unknown;
}
export interface AssistantToolPart {
    type: "tool";
    id: string;
    name: string;
    state: ToolState;
    time: {
        created: number;
        ran?: number;
        completed?: number;
    };
}
export type AssistantContentPart = AssistantTextPart | AssistantReasoningPart | AssistantToolPart;
export interface AssistantMessage extends MessageBase {
    type: "assistant";
    agent: string;
    model: ModelRef;
    content: AssistantContentPart[];
    finish?: string;
    cost?: number;
    tokens?: TokenUsage;
    error?: {
        type: "unknown";
        message: string;
    };
    time: {
        created: number;
        completed?: number;
    };
}
export interface ShellMessage extends MessageBase {
    type: "shell";
    callID: string;
    command: string;
    output: string;
    time: {
        created: number;
        completed?: number;
    };
}
export interface SystemMessage extends MessageBase {
    type: "system";
    text: string;
}
export interface SyntheticMessage extends MessageBase {
    type: "synthetic";
    sessionID: string;
    text: string;
}
export interface AgentSwitchedMessage extends MessageBase {
    type: "agent-switched";
    agent: string;
}
export interface ModelSwitchedMessage extends MessageBase {
    type: "model-switched";
    model: ModelRef;
}
export type SessionMessage = UserMessage | AssistantMessage | ShellMessage | SystemMessage | SyntheticMessage | AgentSwitchedMessage | ModelSwitchedMessage;
export interface V2EventBase {
    id: string;
    type: string;
    durable?: {
        aggregateID: string;
        seq: number;
        version: number;
    };
    location?: LocationRef;
    metadata?: Record<string, unknown>;
}
export interface V2Event<T extends string = string, D = unknown> extends V2EventBase {
    type: T;
    data: D;
}
export declare function makeEvent<T extends string, D>(type: T, data: D, opts?: {
    location?: LocationRef;
    durable?: {
        aggregateID: string;
        seq: number;
        version: number;
    };
}): V2Event<T, D>;
/** 会话事件 data 的公共字段 */
export interface SessionEventDataBase {
    timestamp: number;
    sessionID: string;
}
export declare function promptData(sessionID: string, messageID: string, text: string): SessionEventDataBase & {
    messageID: string;
    prompt: {
        text: string;
        files?: unknown[];
        agents?: unknown[];
    };
    delivery: string;
};
export declare function stepStartedData(sessionID: string, assistantMessageID: string, agent: string, model: ModelRef): SessionEventDataBase & {
    assistantMessageID: string;
    agent: string;
    model: ModelRef;
};
export declare function stepEndedData(sessionID: string, assistantMessageID: string, finish: string): SessionEventDataBase & {
    assistantMessageID: string;
    finish: string;
    cost: number;
    tokens: TokenUsage;
};
export declare function textStartedData(sessionID: string, assistantMessageID: string, textID: string): SessionEventDataBase & {
    assistantMessageID: string;
    textID: string;
};
export declare function textDeltaData(sessionID: string, assistantMessageID: string, textID: string, delta: string): SessionEventDataBase & {
    assistantMessageID: string;
    textID: string;
    delta: string;
};
export declare function textEndedData(sessionID: string, assistantMessageID: string, textID: string, text: string): SessionEventDataBase & {
    assistantMessageID: string;
    textID: string;
    text: string;
};
export declare function reasoningStartedData(sessionID: string, assistantMessageID: string, reasoningID: string): SessionEventDataBase & {
    assistantMessageID: string;
    reasoningID: string;
};
export declare function reasoningDeltaData(sessionID: string, assistantMessageID: string, reasoningID: string, delta: string): SessionEventDataBase & {
    assistantMessageID: string;
    reasoningID: string;
    delta: string;
};
export declare function reasoningEndedData(sessionID: string, assistantMessageID: string, reasoningID: string, text: string): SessionEventDataBase & {
    assistantMessageID: string;
    reasoningID: string;
    text: string;
};
export declare function toolInputStartedData(sessionID: string, assistantMessageID: string, callID: string, name: string): SessionEventDataBase & {
    assistantMessageID: string;
    callID: string;
    name: string;
};
export declare function toolInputEndedData(sessionID: string, assistantMessageID: string, callID: string, text: string): SessionEventDataBase & {
    assistantMessageID: string;
    callID: string;
    text: string;
};
export declare function toolCalledData(sessionID: string, assistantMessageID: string, callID: string, tool: string, input: Record<string, unknown>): SessionEventDataBase & {
    assistantMessageID: string;
    callID: string;
    tool: string;
    input: Record<string, unknown>;
    provider: {
        executed: boolean;
    };
};
export declare function toolSuccessData(sessionID: string, assistantMessageID: string, callID: string, content: unknown[], structured: Record<string, unknown>, result?: unknown): SessionEventDataBase & {
    assistantMessageID: string;
    callID: string;
    structured: Record<string, unknown>;
    content: unknown[];
    result?: unknown;
    provider: {
        executed: boolean;
    };
};
export declare function toolFailedData(sessionID: string, assistantMessageID: string, callID: string, message: string): SessionEventDataBase & {
    assistantMessageID: string;
    callID: string;
    error: {
        type: "unknown";
        message: string;
    };
    provider: {
        executed: boolean;
    };
};
export declare function shellStartedData(sessionID: string, messageID: string, callID: string, command: string): SessionEventDataBase & {
    messageID: string;
    callID: string;
    command: string;
};
export declare function shellEndedData(sessionID: string, callID: string, output: string): SessionEventDataBase & {
    callID: string;
    output: string;
};
export interface AgentInfo {
    id: string;
    model?: ModelRef;
    request: {
        headers: Record<string, unknown>;
        body: Record<string, unknown>;
    };
    system?: string;
    description?: string;
    mode: "subagent" | "primary" | "all";
    hidden: boolean;
    color?: string;
    steps?: number;
    permissions: unknown[];
}
export declare function makeAgentInfo(id: string, description?: string): AgentInfo;
/** 旧协议 Provider（/config/providers 用） */
export interface LegacyProvider {
    id: string;
    name: string;
    source: "env" | "config" | "custom" | "api";
    env: string[];
    options: Record<string, unknown>;
    models: Record<string, LegacyModel>;
}
export interface LegacyModel {
    id: string;
    providerID: string;
    family?: string;
    name: string;
    limit?: {
        context: number;
        output: number;
    };
    cost?: {
        input: number;
        output: number;
    };
    options?: Record<string, unknown>;
    attachment?: boolean;
    reasoning?: boolean;
    toolCall?: boolean;
}
/** 把 v2 Model.Info 转成旧协议 Model（/config/providers 的 models 表）。 */
export declare function legacyModelFromV2(info: {
    id: string;
    providerID: string;
    name: string;
    family?: string;
}): LegacyModel;
