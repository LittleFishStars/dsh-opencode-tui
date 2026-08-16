import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-session-query";
import "@deepseek-ai/dsh-session-persistence";
/** 稳定 Cordis 插件名。 */
declare const name = "dsh-opencode-tui";
/** 需要的服务。 */
declare const inject: string[];
declare const Config: Schema<Schemastery.ObjectS<{
    /** 模型提供方（默认跟随 agentDefaultModel） */
    provider: Schema<string, string>;
    model: Schema<string, string>;
    /** 推理强度档位 */
    effort: Schema<string, string>;
    /** 启动即恢复的会话 id */
    sessionId: Schema<string, string>;
    /** 全屏（alt screen）模式 */
    fullscreen: Schema<boolean, boolean>;
    /** 工作目录（默认 process.cwd()） */
    cwd: Schema<string, string>;
    /** 初始屏品牌文案 */
    brand: Schema<string, string>;
}>, Schemastery.ObjectT<{
    /** 模型提供方（默认跟随 agentDefaultModel） */
    provider: Schema<string, string>;
    model: Schema<string, string>;
    /** 推理强度档位 */
    effort: Schema<string, string>;
    /** 启动即恢复的会话 id */
    sessionId: Schema<string, string>;
    /** 全屏（alt screen）模式 */
    fullscreen: Schema<boolean, boolean>;
    /** 工作目录（默认 process.cwd()） */
    cwd: Schema<string, string>;
    /** 初始屏品牌文案 */
    brand: Schema<string, string>;
}>>;
/** Config 输出类型（schema 校验后的形状）。 */
interface PluginConfig {
    provider?: string;
    model?: string;
    effort?: string;
    sessionId?: string;
    fullscreen: boolean;
    cwd?: string;
    brand: string;
}
declare function apply(ctx: Context, config: PluginConfig): () => void;
export { Config, apply, inject, name };
