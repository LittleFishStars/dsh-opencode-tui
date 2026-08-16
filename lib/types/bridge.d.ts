import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-session-query";
import "@deepseek-ai/dsh-session-persistence";
declare const name = "dsh-opencode-bridge";
declare const inject: string[];
declare const Config: Schema<Schemastery.ObjectS<{
    provider: Schema<string, string>;
    model: Schema<string, string>;
    preset: Schema<string, string>;
    cwd: Schema<string, string>;
}>, Schemastery.ObjectT<{
    provider: Schema<string, string>;
    model: Schema<string, string>;
    preset: Schema<string, string>;
    cwd: Schema<string, string>;
}>>;
interface PluginConfig {
    provider?: string;
    model?: string;
    preset?: string;
    cwd?: string;
}
declare function apply(ctx: Context, config: PluginConfig): () => void;
export { Config, apply, inject, name };
