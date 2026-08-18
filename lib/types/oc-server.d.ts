/**
 * opencode server 协议兼容层：HTTP 服务外观。
 *
 * 职责边界（按功能拆分，见各模块）：
 * - `types.ts`        协议类型与常量
 * - `session-store.ts` 会话存储（生命周期/SSE 推送/模型选择）
 * - `event-mapper.ts`  DSH 事件 → opencode 事件（handleDshEvent/审批/提问）
 * - `routes/api.ts`   v2 路由（/api/*）
 * - `routes/legacy.ts` 旧协议路由（/session/:id/* 与杂项旧路径）
 * - `http-util.ts`    HTTP 工具（JSON/SSE/body）
 * - `oc-proto.ts`     协议对象构造（located/sessionInfo/model/agent）
 * - `projection.ts`   DSH 会话事件日志 → 消息视图 → 旧协议消息
 *
 * 本类只保留：HTTP 服务器生命周期、路由分发、prompt 触发（onPrompt 回调）、
 * 删除会话编排，以及路由模块依赖的服务方法（RouterContext 实现）。
 */
import { type ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ModelSelection } from "@deepseek-ai/dsh-agent";
import { type LegacyModel, type ModelRef } from "./oc-proto.js";
import { SessionStore } from "./session-store.js";
import { DshEventMapper } from "./event-mapper.js";
import { type SessionState } from "./types.js";
import type { RouterContext } from "./routes/context.js";
export interface OcServerOptions {
    directory: string;
    /** 监听端口（默认 0 = 随机） */
    port?: number;
    /** 由 plugin 提供：创建/恢复 agent 并发送消息；返回 DSH session id 供绑定。
     *  hooks.onSession 必须在 send 之前同步调用（避免 turn/start 事件早于绑定而丢失）。 */
    onPrompt: (text: string, opts: {
        resumeSessionId?: string;
        preset?: string;
        model?: ModelRef;
    }, hooks: {
        onSession: (dshSessionId: string) => void;
    }) => Promise<string | undefined>;
    /** 获取当前模型选择（provider/model） */
    getSelection: () => ModelSelection | undefined;
    /** 列出某 provider 可用的全部模型（模型选择窗口的数据源） */
    listModels?: (provider: string) => Promise<Array<{
        id: string;
        name: string;
        description?: string;
        contextWindow?: number;
    }>>;
    /** 查询 DSH 会话投影（启动时重建历史） */
    listDshSessions?: () => Promise<Array<{
        sessionId: string;
        title: string;
        preset?: string;
        createdAt: number;
        views: import("./projection.js").MessageView[];
        todos: Array<{
            id: string;
            content: string;
            status: string;
            priority: string;
        }>;
        diffs: Array<{
            file: string;
            before: string;
            after: string;
            additions: number;
            deletions: number;
        }>;
    }>>;
    /** 删除 DSH 会话（释放活跃 agent + 删除持久化数据）。由 plugin 提供。 */
    onDeleteSession?: (dshSessionId: string) => Promise<void>;
}
export declare class OcServer implements RouterContext {
    readonly store: SessionStore;
    readonly events: DshEventMapper;
    readonly directory: string;
    private ctx;
    private opts;
    private http;
    private port;
    constructor(ctx: Context, opts: OcServerOptions);
    start(): Promise<number>;
    get url(): string;
    stop(): Promise<void>;
    /** DSH 事件 → opencode 事件（由 plugin 在 ctx.on('session/event') 调用）。 */
    handleDshEvent(session: {
        id: string;
        title?: string;
    }, event: SessionEvent): void;
    /** DSH approval/request → TUI permission 对话框（由 plugin 的审批钩子调用）。 */
    handleApproval(dshSessionId: string, request: {
        toolName: string;
        callId?: string;
        reason?: string;
    }): Promise<"allowed-once" | "rejected"> | undefined;
    /** DSH user question → TUI question 对话框（由 plugin 的提问 provider 调用）。 */
    handleQuestion(dshSessionId: string, items: Parameters<DshEventMapper["handleQuestion"]>[1]): Promise<unknown> | undefined;
    getSessionIdByDsh(dshSessionId: string): string | undefined;
    projectId(directory: string): string;
    /** 旧协议 Provider（/config/providers、/provider、/api/provider、/api/model） */
    legacyProvider(): Promise<{
        id: string;
        name: string;
        source: string;
        env: string[];
        options: Record<string, unknown>;
        models: Record<string, LegacyModel>;
    } | undefined>;
    /** 旧协议 Session（/session 列表） */
    legacySession(state: SessionState): Record<string, unknown>;
    sessionOr404(state: SessionState | undefined, res: ServerResponse): state is SessionState;
    /** 消息请求的模型切换：payload.model → 会话当前模型。 */
    applyRequestModel(state: SessionState, payload: Record<string, unknown>): void;
    /** 触发 DSH agent（preset/model 随消息传递）并绑定会话、通知变更。 */
    runPrompt(state: SessionState, text: string, opts: {
        preset?: string;
    }): void;
    /** 触发 DSH agent（不通知会话变更；prompt_async 用）。返回 DSH session id。 */
    sendPrompt(text: string, opts: {
        resumeSessionId?: string;
    }): Promise<string | undefined>;
    bindDshSession(ocSessionId: string, dshSessionId: string): void;
    /**
     * 删除会话（DELETE /session/:id）：先删 DSH 侧数据（可能抛错），
     * 成功后移除内存状态并通知 TUI。
     */
    deleteSession(sessionId: string): Promise<boolean>;
    /**
     * 查询 DSH 会话列表（直查 sessionQuery，以 DSH 为权威数据源）。
     * 合并兼容层状态（含消息/tokens/agents），解决"读自己的而不是 DSH 的"。
     */
    private _listSessionsBusy;
    listSessions(scope?: string | null): Promise<Array<Record<string, unknown>>>;
    /** 从 DSH 会话文件加载事件并 hydrate 到兼容层。 */
    private hydrateFromFilesystem;
    private handle;
}
