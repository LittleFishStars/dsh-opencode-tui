import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
declare const name = "dsh-opencode-tui";
declare const inject: string[];
declare const Config: Schema<Schemastery.ObjectS<{
    /** opencode fork 二进制路径（默认自动定位） */
    binary: Schema<string, string>;
    /** 桥子进程使用的 profile 名（默认 dsh-opencode-tui） */
    bridgeProfile: Schema<string, string>;
    /** 透传给 opencode 的附加参数 */
    args: Schema<string[], string[]>;
}>, Schemastery.ObjectT<{
    /** opencode fork 二进制路径（默认自动定位） */
    binary: Schema<string, string>;
    /** 桥子进程使用的 profile 名（默认 dsh-opencode-tui） */
    bridgeProfile: Schema<string, string>;
    /** 透传给 opencode 的附加参数 */
    args: Schema<string[], string[]>;
}>>;
interface PluginConfig {
    binary?: string;
    bridgeProfile?: string;
    args?: string[];
}
declare function apply(ctx: Context, config: PluginConfig): (() => void) | undefined;
export { Config, apply, inject, name };
