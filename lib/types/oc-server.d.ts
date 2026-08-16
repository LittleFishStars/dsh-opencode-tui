import type { Context } from "@deepseek-ai/cordis";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { ModelSelection } from "@deepseek-ai/dsh-agent";
export interface OcServerOptions {
    directory: string;
    /** 监听端口（默认 0 = 随机） */
    port?: number;
    /** 由 plugin 提供：创建/恢复 agent 并发送消息；返回 DSH session id 供绑定。
     *  hooks.onSession 必须在 send 之前同步调用（避免 turn/start 事件早于绑定而丢失）。 */
    onPrompt: (text: string, opts: {
        resumeSessionId?: string;
    }, hooks: {
        onSession: (dshSessionId: string) => void;
    }) => Promise<string | undefined>;
    /** 获取当前模型选择（provider/model） */
    getSelection: () => ModelSelection | undefined;
    /** 查询 DSH 会话投影（启动时重建历史） */
    listDshSessions?: () => Promise<Array<{
        sessionId: string;
        title: string;
        views: import("./projection.js").MessageView[];
    }>>;
}
export declare class OcServer {
    private sessions;
    private globalSse;
    private opts;
    private ctx;
    private http;
    private port;
    private modelCache;
    constructor(ctx: Context, opts: OcServerOptions);
    start(): Promise<number>;
    get url(): string;
    stop(): Promise<void>;
    private sendJson;
    private sseHeaders;
    /** 推旧协议事件（{directory, payload: {type, properties}}）到全局事件流。 */
    private pushLegacyEvent;
    private pushSessionEvent;
    private sessionOr404;
    private getOrCreateSession;
    /** 把 DSH 会话视图重建为 opencode 会话状态（进程内；ocSessionId 由 dshSessionId 稳定哈希）。 */
    private hydrateSession;
    private selection;
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
    private toolPart;
    private findMessage;
    private findByDsh;
    private handle;
    private infoOf;
    /** 旧协议 Session（/session 列表） */
    private legacySession;
    private legacySessionInfo;
    private legacyProvider;
    /** 记录 DSH session id 与 opencode session id 的绑定（agent 创建后由 plugin 调用）。 */
    bindDshSession(ocSessionId: string, dshSessionId: string): void;
    getSessionIdByDsh(dshSessionId: string): string | undefined;
}
