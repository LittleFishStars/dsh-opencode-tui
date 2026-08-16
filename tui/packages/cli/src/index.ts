#!/usr/bin/env bun
/**
 * lildax 极简入口：直连 DSH 兼容层（OPENCODE_URL）。
 *
 * 原版 CLI 是全功能命令集（serve/daemon/api/migrate 等），本精简版只保留
 * TUI 直连模式：读取 OPENCODE_URL + OPENCODE_SERVER_PASSWORD 后启动原版 TUI，
 * 由 DSH 插件（dsh-opencode-tui）作为唯一 server 提供协议。
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { runTui } from "./tui"

const url = process.env.OPENCODE_URL
if (!url) {
  process.stderr.write("lildax: OPENCODE_URL is required (dsh-opencode-tui compat layer)\n")
  process.exit(1)
}
// runTui 返回 Effect（TUI 渲染循环）；必须用 NodeRuntime.runMain 执行，
// 直接 await Effect 对象不会运行。
runTui({ url, headers: {} }).pipe(
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  NodeRuntime.runMain,
)
