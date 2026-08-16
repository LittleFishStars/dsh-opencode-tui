import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-agent-default-model";
declare const name = "dsh-opencode-tui";
declare const inject: string[];
declare const Config: Schema<Schemastery.ObjectS<{
    /** lildax 二进制路径（默认自动定位） */
    binary: Schema<string, string>;
    /** agent preset id（默认取 roster 默认） */
    preset: Schema<string, string>;
    /** 工作目录（默认进程 cwd） */
    cwd: Schema<string, string>;
    /** 透传给 TUI 的附加参数 */
    args: Schema<string[], string[]>;
    /** 兼容层监听端口（默认 0 = 随机） */
    serverPort: Schema<number, number>;
}>, Schemastery.ObjectT<{
    /** lildax 二进制路径（默认自动定位） */
    binary: Schema<string, string>;
    /** agent preset id（默认取 roster 默认） */
    preset: Schema<string, string>;
    /** 工作目录（默认进程 cwd） */
    cwd: Schema<string, string>;
    /** 透传给 TUI 的附加参数 */
    args: Schema<string[], string[]>;
    /** 兼容层监听端口（默认 0 = 随机） */
    serverPort: Schema<number, number>;
}>>;
interface PluginConfig {
    binary?: string;
    preset?: string;
    cwd?: string;
    args?: string[];
    serverPort?: number;
}
declare function apply(ctx: Context, config: PluginConfig): (() => Promise<void>) | undefined;
export { Config, apply, inject, name };
