/**
 * 路由上下文：OcServer 提供给路由模块的服务接口。
 *
 * 路由模块（api.ts / legacy.ts）只依赖本接口与 SessionStore，
 * 不直接引用 OcServer——保证路由可独立测试、低耦合。
 */
import type { ServerResponse } from "node:http";
import type { SessionStore } from "../session-store.js";
import type { SessionState } from "../types.js";
export interface RouterContext {
    directory: string;
    store: SessionStore;
    projectId(directory: string): string;
    /** 旧协议 Provider（/config/providers、/provider、/api/provider、/api/model） */
    legacyProvider(): Promise<{
        id: string;
        name: string;
        source: string;
        env: string[];
        options: Record<string, unknown>;
        models: Record<string, import("../oc-proto.js").LegacyModel>;
    } | undefined>;
    /** 旧协议 Session（/session 列表） */
    legacySession(state: SessionState): Record<string, unknown>;
    sessionOr404(state: SessionState | undefined, res: ServerResponse): state is SessionState;
    /** 消息请求的模型切换：payload.model → 会话当前模型。 */
    applyRequestModel(state: SessionState, payload: Record<string, unknown>): void;
    /** 触发 DSH agent 并绑定会话、通知变更。 */
    runPrompt(state: SessionState, text: string, opts: {
        preset?: string;
    }): void;
    /** 触发 DSH agent（不通知会话变更；prompt_async 用）。返回 DSH session id。 */
    sendPrompt(text: string, opts: {
        resumeSessionId?: string;
    }): Promise<string | undefined>;
    /** 记录 DSH session id 与 opencode session id 的绑定。 */
    bindDshSession(ocSessionId: string, dshSessionId: string): void;
    /** 删除会话（DSH 侧数据 + 内存 + 通知）。 */
    deleteSession(sessionId: string): Promise<boolean>;
    /**
     * 查询 DSH 会话列表（直查 sessionQuery，而非仅读兼容层内存）。
     * 返回按工作目录过滤的 opencode 会话形状，合并兼容层状态。
     * 解决"会话列表读自己的而不是 DSH 的"——以 DSH 为权威数据源。
     */
    listSessions(scope?: string | null): Promise<Array<Record<string, unknown>>>;
    /** 按需加载会话完整消息（用户进入会话时从文件系统 hydrate）。 */
    hydrateSessionOnDemand(state: import("../types.js").SessionState): Promise<void>;
    /** 会话标题缓存（启动时加载，避免每次解压）。 */
    titleCache: {
        keys(): string[];
    };
}
