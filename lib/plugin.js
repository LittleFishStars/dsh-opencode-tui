/**
 * dsh-opencode-tui 插件入口：opencode 原版 TUI 启动器。
 *
 * `dsh --profile dsh-opencode-tui` 启动本插件，它：
 *   1. 定位 opencode fork 二进制（配置 > 包内 ../opencode-fork > $DSH_HOME/opencode-fork），
 *      缺失时用 go build 编译；
 *   2. 以 DSH_BRIDGE=1 将其作为子进程启动（stdio 继承，终端交给 opencode）；
 *   3. opencode 内部再拉起 dsh 桥子进程（--patch bridge.yml 只激活
 *      dsh-opencode-bridge 插件，不递归启动本插件）；
 *   4. 子进程退出后透传退出码结束 dsh。
 *
 * 会话与消息存储在 dsh 的 ~/.dsh/sessions；UI 完全由 opencode 原版提供。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
const name = "dsh-opencode-tui";
const inject = [];
const Config = Schema.object({
    /** opencode fork 二进制路径（默认自动定位） */
    binary: Schema.string().required(false),
    /** 桥子进程使用的 profile 名（默认 dsh-opencode-tui） */
    bridgeProfile: Schema.string().required(false),
    /** 透传给 opencode 的附加参数 */
    args: Schema.array(Schema.string()).required(false),
});
/** 包内 fork 目录（开发/本地 link 模式）。 */
const PACKAGE_FORK = join(dirname(fileURLToPath(import.meta.url)), "..", "opencode-fork");
/** 按优先级解析 opencode 二进制路径。 */
function resolveBinary(config) {
    const candidates = [];
    if (config.binary)
        candidates.push(config.binary);
    candidates.push(join(PACKAGE_FORK, "opencode"));
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    candidates.push(join(dshHome, "opencode-fork", "opencode"));
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    // 返回首选路径（供编译提示）
    return candidates[0] ?? null;
}
/** 缺失时编译 fork；返回是否可用。 */
function ensureBuilt(binary, ctx) {
    if (existsSync(binary))
        return true;
    const forkDir = dirname(binary);
    if (!existsSync(join(forkDir, "go.mod"))) {
        ctx.logger.error(`dsh-opencode-tui: opencode fork 不存在（${forkDir}）。请先克隆并编译：` +
            `git clone https://github.com/opencode-ai/opencode.git ${forkDir} && cd ${forkDir} && go build -o opencode .`);
        return false;
    }
    ctx.logger.info("dsh-opencode-tui: 编译 opencode fork（go build）…");
    const build = spawnSync("go", ["build", "-o", "opencode", "."], {
        cwd: forkDir,
        stdio: "inherit",
        shell: process.platform === "win32",
    });
    if (build.status !== 0) {
        ctx.logger.error(`dsh-opencode-tui: 编译失败（go >= 1.24 需要）。手工执行：cd ${forkDir} && go build -o opencode .`);
        return false;
    }
    return true;
}
function apply(ctx, config) {
    // 防递归：本进程已是桥子进程（DSH_BRIDGE=1）却仍激活了本插件，
    // 说明 bridge.yml 覆盖层没生效——直接报错，绝不再次 spawn。
    if (process.env.DSH_BRIDGE === "1") {
        ctx.logger.warn("dsh-opencode-tui: DSH_BRIDGE 已设置但本插件仍被激活——bridge.yml 覆盖层未生效（--patch bridge.yml 缺失？），拒绝递归启动。");
        return;
    }
    const binary = resolveBinary(config);
    if (!binary) {
        ctx.logger.error("dsh-opencode-tui: 无法定位 opencode fork。");
        return;
    }
    if (!ensureBuilt(binary, ctx))
        return;
    const bridgeProfile = config.bridgeProfile ?? process.env.DSH_BRIDGE_PROFILE ?? "dsh-opencode-tui";
    const child = spawn(binary, config.args ?? [], {
        stdio: "inherit",
        env: {
            ...process.env,
            DSH_BRIDGE: "1",
            DSH_BRIDGE_PROFILE: bridgeProfile,
            NODE_ENV: "production",
        },
        shell: process.platform === "win32",
    });
    // 信号转发：dsh 收到 Ctrl+C / SIGTERM 时交给 opencode 处理（它负责恢复终端）。
    const forward = (signal) => {
        try {
            child.kill(signal);
        }
        catch {
            /* 子进程已退出 */
        }
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("error", (error) => {
        ctx.logger.error(`dsh-opencode-tui: 启动 opencode 失败：${error.message}`);
    });
    child.on("exit", (code, signal) => {
        process.removeListener("SIGINT", forward);
        process.removeListener("SIGTERM", forward);
        const exitCode = signal !== null && code === null ? 130 : (code ?? 0);
        const exit = ctx.get("appExit");
        if (exit)
            exit(exitCode);
        else
            process.exit(exitCode);
    });
    return () => {
        process.removeListener("SIGINT", forward);
        process.removeListener("SIGTERM", forward);
        try {
            child.kill("SIGKILL");
        }
        catch {
            /* 已退出 */
        }
    };
}
export { Config, apply, inject, name };
//# sourceMappingURL=plugin.js.map