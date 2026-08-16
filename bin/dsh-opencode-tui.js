#!/usr/bin/env node
/**
 * dsh-opencode-tui — opencode 风格 DSH TUI 的一键直达启动器。
 *
 * 全局安装后获得 `dsh-opencode-tui` 命令，免去手工输入
 * `dsh --profile opencode`：
 *
 *   1. 检测 dsh CLI（缺失时提示安装 @deepseek-ai/dsh）；
 *   2. 检测 $DSH_HOME/profiles/opencode 是否已初始化，未初始化则自动执行
 *      `dsh plugin --profile opencode add <本包>` 自举；
 *   3. 透传全部参数启动 `dsh --profile opencode`。
 *
 * `--resume <id>` 直接透传给 dsh（插件从 cmdlineArgs 读取）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ownVersion = JSON.parse(
  (await import("node:fs")).readFileSync(join(here, "..", "package.json"), "utf8"),
).version;
const PACKAGE = "dsh-opencode-tui";
const PROFILE = "opencode";

// 强制 React production（避免 dev 构建的性能埋点与警告）。
process.env.NODE_ENV ??= "production";

const isWin = process.platform === "win32";
const shellOpt = isWin ? { shell: true } : {};

// --- 1. dsh CLI 预检 ---------------------------------------------------------
const probe = spawnSync("dsh", ["--version"], { stdio: "pipe", ...shellOpt });
if (probe.error || probe.status !== 0) {
  console.error("[dsh-opencode-tui] 未检测到 dsh CLI。请先安装官方客户端：");
  console.error("  npm install -g @deepseek-ai/dsh");
  process.exit(1);
}

// --- 2. profile 自举 ----------------------------------------------------------
const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
const profileDir = join(dshHome, "profiles", PROFILE);
const selfPath = join(here, "..");
if (!existsSync(join(profileDir, "node_modules", PACKAGE))) {
  const pnpmProbe = spawnSync("pnpm", ["--version"], { stdio: "pipe", ...shellOpt });
  if (pnpmProbe.error || pnpmProbe.status !== 0) {
    console.error("[dsh-opencode-tui] 首次安装需要 pnpm（dsh plugin 会把安装转发给它）：");
    console.error("  npm install -g pnpm   （或启用 corepack：corepack enable pnpm）");
    process.exit(1);
  }
  console.log(`[dsh-opencode-tui] 首次运行，正在初始化 ${PROFILE} profile（${PACKAGE}@${ownVersion}）…`);
  const add = spawnSync(
    "dsh",
    ["plugin", "--profile", PROFILE, "add", selfPath],
    { stdio: "inherit", ...shellOpt },
  );
  if (add.status !== 0) {
    console.error("[dsh-opencode-tui] 插件安装失败。可稍后手工重试：");
    console.error(`  dsh plugin --profile ${PROFILE} add ${selfPath}`);
    process.exit(add.status ?? 1);
  }
}

// --- 3. 透传启动 ---------------------------------------------------------------
const result = spawn("dsh", ["--profile", PROFILE, ...process.argv.slice(2)], {
  stdio: "inherit",
  ...shellOpt,
});
result.on("exit", (code) => process.exit(code ?? 0));
