import { DynamicProviderPlugin } from "./provider/dynamic"
import { OpencodePlugin } from "./provider/opencode"
import type { PluginInternal } from "./internal"
import type { Scope } from "effect"

// 精简版：只保留 opencode 内置 + 动态 provider（DSH 直连模式不会创建任何
// 第三方 provider；原版注册全部 AI SDK provider，需要大量 @ai-sdk/* 依赖）。
export const ProviderPlugins: PluginInternal.Plugin<PluginInternal.Requirements | Scope.Scope>[] = [
  OpencodePlugin,
  DynamicProviderPlugin,
]
