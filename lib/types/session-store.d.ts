/**
 * 会话存储：opencode 会话集合的内存管理 + SSE 推送 + 模型选择。
 *
 * 从 oc-server.ts 拆出。职责：
 * - 会话生命周期：getOrCreate / hydrate（DSH 持久层重建）/ 删除
 * - 事件推送：SSE 连接集合、legacy 事件信封、session.updated 通知
 * - 模型选择：全局 selection / 会话切换模型 / provider 模型目录缓存
 * - 查询：按 DSH session id 反查、按消息 id 查消息
 */
import type { ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import { type ModelRef, type SessionInfo } from "./oc-proto.js";
import { type OutgoingEvent, type SessionState } from "./types.js";
/** DSH 会话 id → 稳定 opencode 会话 id（重启后保持一致）。 */
export declare function ocIdFromDsh(dshSessionId: string): string;
export declare function projectIdOf(directory: string): string;
export interface SessionStoreOptions {
    directory: string;
    /** 获取当前模型选择（provider/model） */
    getSelection: () => {
        provider: string;
        model: string;
    } | undefined;
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
}
export declare class SessionStore {
    readonly sessions: Map<string, SessionState>;
    readonly globalSse: Set<ServerResponse<import("http").IncomingMessage>>;
    /** 已被兼容层删除的会话 id（DSH 侧删除可能延迟同步，需从列表过滤）。 */
    private deleted;
    private opts;
    private modelCache;
    /** 最近一次请求头里的模型上下文窗口（maxTokens；供 limit.context 百分比计算） */
    modelContext: number | undefined;
    /** provider → 模型目录缓存（listModels 结果） */
    private modelsCache;
    /** 历史会话重建 promise：会话列表/详情请求等待它完成，避免 hydrate 前返回空列表。 */
    private hydratePromise;
    constructor(_ctx: Context, opts: SessionStoreOptions);
    /** 预热模型缓存 + 异步重建历史会话（列表/详情请求会等待）。 */
    init(): void;
    private runHydrate;
    /** 等待历史会话重建完成（带超时兜底，避免 hydrate 挂起卡住请求）。 */
    waitHydrate(): Promise<void>;
    getOrCreateSession(id: string, directory: string): SessionState;
    /** 把 DSH 会话视图重建为 opencode 会话状态（进程内；ocSessionId 由 dshSessionId 稳定哈希）。 */
    hydrateSession(dshSessionId: string, title: string, preset: string | undefined, views: import("./projection.js").MessageView[], todos: Array<{
        id: string;
        content: string;
        status: string;
        priority: string;
    }>, diffs: Array<{
        file: string;
        before: string;
        after: string;
        additions: number;
        deletions: number;
    }>, dshCreatedAt: number): void;
    /** 删除会话：从内存移除 + 通知 TUI。返回是否成功。 */
    removeSession(sessionId: string): boolean;
    /** 某会话是否已被兼容层删除（用于 listSessions 过滤）。 */
    isDeleted(sessionId: string): boolean;
    findByDsh(dshSessionId: string): SessionState | undefined;
    findMessage(state: SessionState, messageId: string): import("./types.js").LegacyMessage | undefined;
    getSessionIdByDsh(dshSessionId: string): string | undefined;
    selection(): ModelRef | undefined;
    /** 会话模型：会话切换的模型优先，否则全局 selection。 */
    sessionModel(state: SessionState): ModelRef | undefined;
    /** 列出 provider 的全部模型（带缓存）。 */
    listModels(provider: string): Promise<Array<{
        id: string;
        name: string;
        description?: string;
        contextWindow?: number;
    }>>;
    infoOf(state: SessionState): SessionInfo;
    /** 推旧协议事件（{directory, payload: {type, properties}}）到全局事件流。 */
    pushEvent(event: OutgoingEvent, directory: string): void;
    pushSessionEvent(state: SessionState, event: OutgoingEvent): void;
    /** 会话变更通知（新会话进 sync.data.session、聚合 token/cost 刷新）。 */
    touchSession(state: SessionState): void;
}
