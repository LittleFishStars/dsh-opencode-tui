#!/usr/bin/env node
/**
 * dsh-opencode-tui — opencode 原版 TUI 的一键启动器（Go 中间层模式）。
 *
 * 流程：
 *   1. 定位 opencode fork（本仓库 opencode-fork/）；
 *   2. 二进制缺失时用 go build 编译（GOPATH/GOCACHE 可经环境变量覆盖）；
 *   3. 以 DSH_BRIDGE=1 启动 opencode，驱动 dsh 桥插件子进程。
 *
 * 界面即 opencode 原版（会话列表/消息/工具卡片/审批对话框全部由 opencode
 * TUI 提供），会话与消息存储在 dsh 的 ~/.dsh/sessions。
 *
 * 想用本仓库自研的 Ink TUI（黑背景/灰侧栏/折叠版）时：dsh --profile dsh-opencode-tui
 */
import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const forkDir = join(repoRoot, "opencode-fork");
const binary = join(forkDir, "opencode");

const isWin = process.platform === "win32";
const shellOpt = isWin ? { shell: true } : {};

// --- 1. 定位 / 编译 opencode fork --------------------------------------------
if (!existsSync(binary)) {
  if (!existsSync(join(forkDir, "go.mod"))) {
    console.error("[dsh-opencode-tui] opencode fork 不存在：" + forkDir);
    console.error("请先克隆：git clone https://github.com/opencode-ai/opencode.git opencode-fork");
    process.exit(1);
  }
  console.log("[dsh-opencode-tui] 首次运行，正在编译 opencode fork（go build）…");
  const build = spawnSync("go", ["build", "-o", "opencode", "."], {
    cwd: forkDir,
    stdio: "inherit",
    ...shellOpt,
  });
  if (build.status !== 0) {
    console.error("[dsh-opencode-tui] 编译失败。请检查 Go 工具链（go >= 1.24）：");
    console.error(`  cd ${forkDir} && go build -o opencode .`);
    process.exit(build.status ?? 1);
  }
}

// --- 2. 桥子进程的 dsh profile（可经环境变量覆盖） ---------------------------
const bridgeProfile = process.env.DSH_BRIDGE_PROFILE ?? "dsh-opencode-tui";
const env = {
  ...process.env,
  DSH_BRIDGE: "1",
  DSH_BRIDGE_PROFILE: bridgeProfile,
  NODE_ENV: process.env.NODE_ENV ?? "production",
};

// --- 3. 启动 opencode 原版 TUI ------------------------------------------------
const result = spawn(binary, process.argv.slice(2), { env, stdio: "inherit", ...shellOpt });
result.on("exit", (code) => process.exit(code ?? 0));
