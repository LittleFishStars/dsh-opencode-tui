/**
 * dsh-opencode-tui 插件入口：opencode 原版 TUI 兼容层启动器。
 *
 * `dsh --profile dsh-opencode-tui` 启动本插件，它：
 *   1. 定位 opencode TUI 二进制（anomalyco/opencode dev 分支构建的 lildax）；
 *   2. 在当前 dsh 进程内启动 opencode server 协议兼容层（OcServer，
 *      实现 opencode TUI 需要的 HTTP 端点，数据源为 DSH agent/会话）；
 *   3. 以 OPENCODE_URL=<兼容层地址> 启动原版 TUI 直连；
 *   4. TUI 退出后透传退出码结束 dsh。
 *
 * 会话与消息存储复用 dsh 的 agent 会话；UI 完全由 opencode 原版提供。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import "@deepseek-ai/dsh-agent-default-model";
import { AgentManager } from "./agent.js";
import { OcServer } from "./oc-server.js";
import { foldSessionMeta, projectEvents } from "./projection.js";
const name = "dsh-opencode-tui";
const inject = ["agents", "sessions", "sessionPersistence", "agentDefaultModel", "sessionQuery"];
const Config = Schema.object({
    /** lildax 二进制路径（默认自动定位） */
    binary: Schema.string().required(false),
    /** agent preset id（默认取 roster 默认） */
    preset: Schema.string().required(false),
    /** 工作目录（默认进程 cwd） */
    cwd: Schema.string().required(false),
    /** 透传给 TUI 的附加参数 */
    args: Schema.array(Schema.string()).required(false),
    /** 兼容层监听端口（默认 0 = 随机） */
    serverPort: Schema.number().required(false),
});
/** 包内 fork 目录（开发/本地 link 模式）。 */
const PACKAGE_FORK = join(dirname(fileURLToPath(import.meta.url)), "..", "opencode-fork");
/** fork dev 构建产物相对路径（bun build --single 输出）。 */
const LILDAX_REL = join("packages", "cli", "dist", "cli-linux-x64", "bin", "lildax");
/** 按优先级解析 lildax 二进制路径。 */
function resolveBinary(config) {
    const candidates = [];
    if (config.binary)
        candidates.push(config.binary);
    candidates.push(join(PACKAGE_FORK, LILDAX_REL));
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    candidates.push(join(dshHome, "opencode-fork", LILDAX_REL));
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    return candidates[0] ?? null;
}
function apply(ctx, config) {
    // 防递归：桥模式（旧 Go 中间层）下不启动。
    if (process.env.DSH_BRIDGE === "1") {
        ctx.logger.warn("dsh-opencode-tui: DSH_BRIDGE 已设置，跳过兼容层启动。");
        return;
    }
    const cwd = config.cwd ?? process.cwd();
    const binary = resolveBinary(config);
    if (!binary || !existsSync(binary)) {
        ctx.logger.error(`dsh-opencode-tui: 未找到 opencode TUI 二进制（${binary ?? "?"}）。` +
            `请先构建：cd opencode-fork/packages/cli && bun run script/build.ts --single --skip-install`);
        return;
    }
    const selection = ctx.agentDefaultModel.currentSelection();
    // 当前活跃 agent（最近一次 onPrompt 创建的会话）
    let activeManager;
    // 历史会话重建：从 DSH 持久层加载会话投影
    const listDshSessions = async () => {
        const out = [];
        try {
            const records = await ctx.sessionQuery.listSessions();
            for (const record of records) {
                const header = record.header;
                try {
                    const inspection = await ctx.sessionPersistence.inspect(header.id);
                    const folded = foldSessionMeta(header.id, header.createdAt, inspection.events);
                    out.push({
                        sessionId: header.id,
                        title: folded.title,
                        views: projectEvents(inspection.events),
                    });
                }
                catch {
                    /* 读不到的会话跳过 */
                }
            }
        }
        catch {
            /* 列表加载失败不致命 */
        }
        return out;
    };
    // ── opencode 协议兼容层 ──────────────────────────────────────────────────
    const ocServer = new OcServer(ctx, {
        directory: cwd,
        port: config.serverPort ?? (process.env.DSH_OPENCODE_TUI_SERVER_PORT ? Number(process.env.DSH_OPENCODE_TUI_SERVER_PORT) : undefined),
        getSelection: () => ctx.agentDefaultModel.currentSelection(),
        listDshSessions,
        onPrompt: async (text, opts, hooks) => {
            // 单活跃 agent：resume 或新建
            const manager = new AgentManager(ctx, {
                selection,
                cwd,
                preset: config.preset ?? process.env.DSH_OPENCODE_TUI_PRESET,
                resumeSessionId: opts.resumeSessionId,
            });
            activeManager = manager;
            const owned = await manager.ensure();
            // 先绑定再发送（turn/start 事件在 followup 后到达，绑定必须先行）
            hooks.onSession(owned.sessionId);
            await manager.send(text);
            return owned.sessionId;
        },
    });
    // DSH 事件 → opencode 事件
    ctx.on("session/event", (session, event) => {
        ocServer.handleDshEvent(session, event);
    });
    // 审批：DSH approval/request → TUI permission 对话框
    ctx.on("approval/request", (req, next) => {
        const owned = activeManager?.current;
        if (owned && String(req.agent.id) === String(owned.agent.id)) {
            const outcome = ocServer.handleApproval(owned.sessionId, {
                toolName: req.toolName,
                callId: req.callId ? String(req.callId) : undefined,
                reason: req.reason,
            });
            if (outcome)
                return outcome;
        }
        return next();
    });
    // ── 启动 server + TUI ────────────────────────────────────────────────────
    let child;
    void ocServer.start().then(async (port) => {
        ctx.logger.info(`dsh-opencode-tui: opencode 兼容层监听 http://127.0.0.1:${port}`);
        child = spawn(binary, config.args ?? [], {
            stdio: "inherit",
            env: {
                ...process.env,
                OPENCODE_URL: `http://127.0.0.1:${port}`,
                OPENCODE_SERVER_PASSWORD: "dsh-opencode-tui",
                NODE_ENV: "production",
            },
            shell: process.platform === "win32",
        });
        const forward = (signal) => {
            try {
                child?.kill(signal);
            }
            catch {
                /* 已退出 */
            }
        };
        process.on("SIGINT", forward);
        process.on("SIGTERM", forward);
        child.on("error", (error) => {
            ctx.logger.error(`dsh-opencode-tui: 启动 opencode TUI 失败：${error.message}`);
        });
        child.on("exit", (code, signal) => {
            process.removeListener("SIGINT", forward);
            process.removeListener("SIGTERM", forward);
            void ocServer.stop();
            const exitCode = signal !== null && code === null ? 130 : (code ?? 0);
            const exit = ctx.get("appExit");
            if (exit)
                exit(exitCode);
            else
                process.exit(exitCode);
        });
    });
    return async () => {
        try {
            child?.kill("SIGKILL");
        }
        catch {
            /* 已退出 */
        }
        await ocServer.stop();
    };
}
export { Config, apply, inject, name };
//# sourceMappingURL=plugin.js.map