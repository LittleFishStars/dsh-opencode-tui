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
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Schema from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from "@deepseek-ai/dsh-user-questions";
import "@deepseek-ai/dsh-agent-default-model";
import "@deepseek-ai/dsh-session-query";
import "@deepseek-ai/dsh-session-persistence";
import { AgentManager } from "./agent.js";
import { OcServer } from "./oc-server.js";
import { diffsFromEvents, foldSessionMeta, projectEvents, todosFromEvents, type MessageView } from "./projection.js";

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

interface PluginConfig {
  binary?: string;
  preset?: string;
  cwd?: string;
  args?: string[];
  serverPort?: number;
}

/**
 * 包内 TUI 目录（opencode 界面代码精简版；开发/本地 link 模式）。
 * 结构：tui/packages/{cli,tui,ui,plugin,sdk,core,schema,llm,...}
 */
const PACKAGE_TUI = join(dirname(fileURLToPath(import.meta.url)), "..", "tui");

/** fork dev 构建产物相对路径（bun build --single 输出）。 */
const LILDAX_REL = join("packages", "cli", "dist", "cli-linux-x64", "bin", "lildax");

/** 按优先级解析 lildax 二进制路径。 */
function resolveBinary(config: PluginConfig): string | null {
  const candidates: string[] = [];
  if (config.binary) candidates.push(config.binary);
  candidates.push(join(PACKAGE_TUI, LILDAX_REL));
  // 旧版目录名（opencode-fork）兼容
  candidates.push(join(dirname(fileURLToPath(import.meta.url)), "..", "opencode-fork", LILDAX_REL));
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  candidates.push(join(dshHome, "tui", LILDAX_REL));
  candidates.push(join(dshHome, "opencode-fork", LILDAX_REL));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? null;
}

function apply(ctx: Context, config: PluginConfig) {
  // 防递归：桥模式（旧 Go 中间层）下不启动。
  if (process.env.DSH_BRIDGE === "1") {
    ctx.logger.warn("dsh-opencode-tui: DSH_BRIDGE 已设置，跳过兼容层启动。");
    return;
  }

  const cwd = config.cwd ?? process.cwd();
  const binary = resolveBinary(config);
  if (!binary || !existsSync(binary)) {
    ctx.logger.error(
      `dsh-opencode-tui: 未找到 opencode TUI 二进制（${binary ?? "?"}）。` +
        `请先构建：cd tui/packages/cli && bun run script/build.ts`,
    );
    return;
  }

  const selection = ctx.agentDefaultModel.currentSelection();

  // 当前活跃 agent（最近一次 onPrompt 创建的会话）
  let activeManager: AgentManager | undefined;

  /** 删除 DSH 会话：释放活跃 agent（若正持有该会话）+ 删除持久化工件。 */
  const onDeleteSession = async (dshSessionId: string): Promise<void> => {
    const owned = activeManager?.current;
    if (owned && String(owned.sessionId) === String(dshSessionId)) {
      await activeManager!.release();
      activeManager = undefined;
      dbgLog(`released active agent for deleted session ${dshSessionId}`);
    }
    // 删除持久化工件：扫描 ~/.dsh/sessions/ 找到 session 目录并删除
    // （sessionQuery.listSessions 在插件进程内返回 0，无法定位 artifact）
    try {
      const fs = await import("node:fs/promises");
      const ocRoot = process.env.DSH_OPENCODE_SESSION_ROOT;
      const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
      const sessionsRoot = ocRoot ? ocRoot : join(dshHome, "sessions");
      const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const cwdDir = join(sessionsRoot, entry.name);
        const sessionDirs = await fs.readdir(cwdDir, { withFileTypes: true }).catch(() => []);
        for (const sd of sessionDirs) {
          if (!sd.isDirectory()) continue;
          const match = sd.name.match(/^session-(.+)$/);
          const matchedId = match ? match[1] : undefined;
          if (!matchedId || matchedId !== dshSessionId) continue;
          const sessionDir = join(cwdDir, sd.name);
          await fs.rm(sessionDir, { recursive: true, force: true });
          dbgLog(`deleted artifact ${sessionDir} for session ${dshSessionId}`);
        }
      }
    } catch (error) {
      dbgLog(`delete artifact for ${dshSessionId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 历史会话重建：从 DSH 持久层加载会话投影（只取当前工作目录的会话，跨目录会话
  // 不进 TUI 会话列表，也避免 hydrate 全部目录导致启动/列表变慢）
  // 历史会话重建：从 DSH 持久层加载会话投影（只取当前工作目录的会话，跨目录会话
  // 不进 TUI 会话列表，也避免 hydrate 全部目录导致启动/列表变慢）
  const dbgLog = (message: string): void => {
    try {
      appendFileSync(join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "logs", "oc-server.log"), `${new Date().toISOString()} [plugin] ${message}\n`);
    } catch {
      /* 忽略 */
    }
  };
  const listDshSessions = async (): Promise<
    Array<{
      sessionId: string;
      title: string;
      preset?: string;
      createdAt: number;
      views: MessageView[];
      todos: Array<{ id: string; content: string; status: string; priority: string }>;
      diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }>;
    }>
  > => {
    const out: Array<{
      sessionId: string;
      title: string;
      preset?: string;
      createdAt: number;
      views: MessageView[];
      todos: Array<{ id: string; content: string; status: string; priority: string }>;
      diffs: Array<{ file: string; before: string; after: string; additions: number; deletions: number }>;
    }> = [];
    let skipped = 0;
    try {
      const records = await ctx.sessionQuery.listSessions();
      for (const record of records) {
        const header = record.header;
        if (header.cwd && cwd && header.cwd !== cwd) {
          skipped++;
          continue;
        }
        try {
          const inspection = await ctx.sessionPersistence.inspect(header.id);
          const folded = foldSessionMeta(header.id, header.createdAt, inspection.events);
          out.push({
            sessionId: header.id,
            title: folded.title,
            preset: folded.preset,
            createdAt: header.createdAt,
            views: projectEvents(inspection.events),
            todos: todosFromEvents(inspection.events),
            diffs: diffsFromEvents(inspection.events),
          });
        } catch (error) {
          dbgLog(`inspect ${header.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      dbgLog(`listSessions -> ${records.length} records (${skipped} skipped for cwd, ${out.length} hydrated)`);
    } catch (error) {
      dbgLog(`listSessions failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return out;
  };

  // ── opencode 协议兼容层 ──────────────────────────────────────────────────
  const llm = ctx.get("llm") as { listModels?: (provider: string) => Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number }>> } | undefined;
  const ocServer = new OcServer(ctx, {
    directory: cwd,
    port: config.serverPort ?? (process.env.DSH_OPENCODE_TUI_SERVER_PORT ? Number(process.env.DSH_OPENCODE_TUI_SERVER_PORT) : undefined),
    getSelection: () => ctx.agentDefaultModel.currentSelection(),
    listModels: llm?.listModels ? ((provider) => llm.listModels!(provider)) : undefined,
    listDshSessions,
    onDeleteSession,
    onPrompt: async (text, opts, hooks) => {
      // 单活跃 agent：同一会话（resumeSessionId 匹配当前）直接 followup，
      // 否则释放旧 agent 后 resume/新建。不能对 live 会话 resume（DSH
      // persistence 拒绝 "cannot prepare session while it is live"）。
      if (activeManager?.current && activeManager.current.sessionId === opts.resumeSessionId) {
        const owned = activeManager.current;
        hooks.onSession(owned.sessionId);
        await activeManager.send(text);
        return owned.sessionId;
      }
      if (activeManager) {
        try {
          await activeManager.release();
        } catch {
          /* 释放失败不阻塞新会话 */
        }
      }
      const manager = new AgentManager(ctx, {
        selection,
        cwd,
        preset: config.preset ?? process.env.DSH_OPENCODE_TUI_PRESET,
        permissionPreset: opts.preset,
        model: opts.model,
        resumeSessionId: opts.resumeSessionId,
      });
      activeManager = manager;
      try {
        const owned = await manager.ensure();
        // 先绑定再发送（turn/start 事件在 followup 后到达，绑定必须先行）
        hooks.onSession(owned.sessionId);
        await manager.send(text);
        return owned.sessionId;
      } catch (error) {
        dbgLog(`onPrompt failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        throw error;
      }
    },
  });

  // DSH 事件 → opencode 事件
  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    ocServer.handleDshEvent(session, event);
  });

  // 审批：DSH approval/request → TUI permission 对话框
  ctx.on(
    "approval/request",
    (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
      const owned = activeManager?.current;
      if (owned && String(req.agent.id) === String(owned.agent.id)) {
        const outcome = ocServer.handleApproval(owned.sessionId, {
          toolName: req.toolName,
          callId: req.callId ? String(req.callId) : undefined,
          reason: req.reason,
        });
        if (outcome) return outcome;
      }
      return next();
    },
  );

  // 用户提问：DSH askUserQuestion → TUI question 对话框
  const userQuestions = ctx.get("userQuestions") as
    | { registerProvider(p: { ask(req: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> }): () => void }
    | undefined;
  if (userQuestions) {
    userQuestions.registerProvider({
      ask: (request) => {
        const owned = activeManager?.current;
        const sessionId = owned?.sessionId;
        if (!sessionId) return Promise.resolve({ answers: [] });
        const outcome = ocServer.handleQuestion(
          sessionId,
          request.questions.map((q) => ({
            id: q.id,
            question: q.question,
            detail: q.detail,
            header: q.header,
            options: q.options,
            multiSelect: q.multiSelect,
          })),
        );
        if (outcome) return outcome as Promise<AskUserQuestionAnswer>;
        return Promise.resolve({ answers: [] });
      },
    });
  }

  // ── 启动 server + TUI ────────────────────────────────────────────────────
  let child: ChildProcess | undefined;
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

    const forward = (signal: NodeJS.Signals): void => {
      try {
        child?.kill(signal);
      } catch {
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
      if (exit) exit(exitCode);
      else process.exit(exitCode);
    });
  });

  return async () => {
    try {
      child?.kill("SIGKILL");
    } catch {
      /* 已退出 */
    }
    await ocServer.stop();
  };
}

export { Config, apply, inject, name };
