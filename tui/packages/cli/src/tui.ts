import { run } from "@opencode-ai/tui"
import { TuiConfig } from "@opencode-ai/tui/config"
import { createBuiltinPlugins } from "@opencode-ai/tui/builtins"
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import type { PluginRuntime } from "@opencode-ai/tui/plugin/runtime"
import type { TuiPluginHost } from "@opencode-ai/tui/plugin/runtime"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"

export function runTui(transport: { url: string; headers: RequestInit["headers"] }) {
  const config = TuiConfig.resolve({}, { terminalSuspend: false })
  return run({
    ...transport,
    args: {},
    config,
    fetch: gracefulFetch,
    pluginHost: createBuiltinPluginHost(),
  }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

/**
 * 最小 TUI 插件 host：加载内置插件（侧边栏 Context/Todo/Files/LSP/MCP、
 * which-key、通知等）。
 *
 * 原版 opencode 的 host（packages/opencode/src/plugin/tui/runtime.ts）依赖
 * 完整 server 环境；本 fork 是 TUI 直连 DSH 兼容层（无 opencode server 进程），
 * 这里只做内置插件的最小激活：把插件的 api.slots.register 转发到
 * runtime.setupSlots() 的注册表（TUI 的 pluginRuntime.Slot 依赖它渲染）。
 */
function createBuiltinPluginHost(): TuiPluginHost {
  let unregister: Array<() => void> = []
  return {
    async start(input: {
      api: TuiPluginApi
      runtime: PluginRuntime
      dispose?: () => void
    }) {
      const slots = input.runtime.setupSlots(input.api)
      const meta = (id: string): TuiPluginMeta => {
        const now = Date.now()
        return {
          state: "same",
          id,
          source: "internal",
          spec: id,
          target: id,
          first_time: now,
          last_time: now,
          time_changed: now,
          load_count: 1,
          fingerprint: id,
        }
      }
      for (const plugin of createBuiltinPlugins({ experimentalEventSystem: false })) {
        const base = plugin.id ?? "internal"
        let count = 0
        // 包装 api：内置插件通过 api.slots.register 注册 sidebar_content 等 slot。
        // 与上游 pluginApi 一致：用插件 id 作前缀 + 计数器生成唯一 slot 插件 id
        //（内置插件调用 register 时不传 id，若全部落成同一 id 会互相覆盖）。
        const api: TuiPluginApi = {
          ...input.api,
          slots: {
            register(slotPlugin) {
              const id = count ? `${base}:${count}` : base
              count += 1
              const off = slots.register({ ...slotPlugin, id })
              unregister.push(off)
              return id
            },
          },
        }
        await plugin.tui(api, undefined, meta(base))
      }
    },
    async dispose() {
      for (const off of unregister) {
        try {
          off()
        } catch {
          /* 忽略单插件清理失败 */
        }
      }
      unregister = []
    },
  }
}

const legacyDefaults: Record<string, unknown> = {
  "/config/providers": { providers: [], default: {} },
  "/provider": { all: [], default: {}, connected: [] },
  "/agent": [],
  "/config": {},
}

const gracefulFetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init)
    if (response.status !== 404) return response
    const fallback = legacyDefaults[new URL(input instanceof Request ? input.url : input).pathname]
    if (fallback === undefined) return response
    return Response.json(fallback)
  },
  { preconnect: fetch.preconnect },
)
