/**
 * 会话事件日志 → TUI 消息视图的投影。
 *
 * 同时支持两种输入：
 * - 全量回放（resume 时 `persistence.inspect(id)` 的完整 events 数组）
 * - 增量订阅（`session/event` 的单个事件）
 *
 * 事件词汇见 @deepseek-ai/dsh-session 的 SessionEventMap。
 */
import type { SessionEvent } from "@deepseek-ai/dsh-session";

export interface ToolCallView {
  /** callId */
  id: string;
  name: string;
  /** 模型产出的原始 JSON 参数串 */
  arguments: string;
  status: "running" | "done" | "error";
  /** 结果文本（拼接 message.content 的 text 块） */
  result?: string;
  /** 结构化失败信息 */
  error?: { name: string; code: string };
  startedAt: number;
  endedAt?: number;
}

export interface UserMessageView {
  kind: "user";
  /** 事件 seq（排序/去重用） */
  seq: number;
  time: number;
  /** 拼接后的文本 */
  content: string;
  /** 消息 id */
  id: string;
}

export interface AssistantMessageView {
  kind: "assistant";
  seq: number;
  /** 当前 step 起始事件 seq（assistant 卡片的标识） */
  id: string;
  time: number;
  /** 流式累积/最终文本 */
  text: string;
  /** 思考（reasoning）文本 */
  thinking: string;
  /** assistant/message 已落地（模型回复完成，可能仍在跑工具） */
  assembled: boolean;
  /** turn/end 已到达 */
  finished: boolean;
  /** turn/end reason kind */
  reason?: string;
  model?: string;
  provider?: string;
  endedAt?: number;
  /** 是否本轮没有文本输出（纯工具轮） */
  empty?: boolean;
}

export interface ToolMessageView {
  kind: "tool";
  seq: number;
  time: number;
  tool: ToolCallView;
}

export type MessageView = UserMessageView | AssistantMessageView | ToolMessageView;

export interface SessionMeta {
  id: string;
  /** session/title 事件折叠出的标题；无则从首条用户消息兜底 */
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  cwd?: string;
  /** 最近一次 permission/preset 事件记录的 preset 名（read-only / workspace-write / danger-full-access） */
  preset?: string;
}

/** 从事件里取用户消息文本（text 块拼接）。 */
function userTextFromMessage(message: { content?: Array<{ type?: string; text?: string }> }): string {
  const blocks = message.content ?? [];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function assistantTextFromMessage(message: { content?: Array<{ type?: string; text?: string }> }): string {
  return userTextFromMessage(message);
}

function toolResultText(message: { content?: Array<{ type?: string; text?: string }> }): string {
  return userTextFromMessage(message);
}

/** 判断一条用户消息是否来自真实用户（过滤 injected context）。 */
function isUserProduced(source: unknown): boolean {
  if (typeof source !== "object" || source === null) return true;
  const kind = (source as { kind?: unknown }).kind;
  return kind === undefined || kind === "user";
}

/**
 * 增量投影：把单个会话事件应用到消息列表上。
 * 返回是否产生了可见变化。
 */
export function applyEvent(messages: MessageView[], event: SessionEvent): boolean {
  switch (event.type) {
    case "user/message": {
      const data = event.data as {
        id?: string;
        content?: Array<{ type?: string; text?: string }>;
        source?: unknown;
      };
      if (!isUserProduced(data.source)) return false;
      const content = userTextFromMessage(data);
      // 空白注入不展示
      if (content.trim() === "") return false;
      messages.push({
        kind: "user",
        seq: event.seq,
        time: event.time,
        content,
        id: data.id ?? `user-${event.seq}`,
      });
      return true;
    }
    case "assistant/chunk": {
      const data = event.data as { chunk?: { type?: string; text?: string; index?: number } };
      const chunk = data.chunk;
      if (!chunk) return false;
      const last = messages[messages.length - 1];
      // 只追加到"当前"assistant 卡片（最后一个 assistant 且未 assembled）
      if (last?.kind === "assistant" && !last.assembled) {
        if (chunk.type === "text-delta" && chunk.text) {
          messages[messages.length - 1] = { ...last, text: last.text + chunk.text, seq: event.seq };
          return true;
        }
        if (chunk.type === "reasoning-delta" && chunk.text) {
          messages[messages.length - 1] = { ...last, thinking: last.thinking + chunk.text, seq: event.seq };
          return true;
        }
        if (chunk.type === "block-end" && chunk.text) {
          // 兼容直接把文本放在 block-end 的适配器
          messages[messages.length - 1] = { ...last, text: last.text + chunk.text, seq: event.seq };
          return true;
        }
      } else if (chunk.type === "text-delta" && chunk.text) {
        // 流式起点：还没有 assistant 卡片时创建一张
        messages.push({
          kind: "assistant",
          seq: event.seq,
          id: `assistant-${event.seq}`,
          time: event.time,
          text: chunk.text,
          thinking: "",
          assembled: false,
          finished: false,
        });
        return true;
      } else if (chunk.type === "reasoning-delta" && chunk.text) {
        messages.push({
          kind: "assistant",
          seq: event.seq,
          id: `assistant-${event.seq}`,
          time: event.time,
          text: "",
          thinking: chunk.text,
          assembled: false,
          finished: false,
        });
        return true;
      }
      return false;
    }
    case "assistant/message": {
      const data = event.data as {
        message?: {
          content?: Array<{ type?: string; text?: string }>;
          source?: { provider?: string; model?: string };
        };
      };
      const message = data.message;
      if (!message) return false;
      const text = assistantTextFromMessage(message);
      const source = message.source;
      const last = messages[messages.length - 1];
      if (last?.kind === "assistant") {
        // 同一轮 assistant/message 落地：以权威内容为准
        messages[messages.length - 1] = {
          ...last,
          text,
          assembled: true,
          seq: event.seq,
          model: source?.model,
          provider: source?.provider,
          empty: text.trim() === "",
        };
        return true;
      }
      messages.push({
        kind: "assistant",
        seq: event.seq,
        id: `assistant-${event.seq}`,
        time: event.time,
        text,
        thinking: "",
        assembled: true,
        finished: false,
        model: source?.model,
        provider: source?.provider,
        empty: text.trim() === "",
      });
      return true;
    }
    case "tool/call": {
      const data = event.data as {
        callId?: string;
        name?: string;
        arguments?: string;
      };
      if (!data.callId || !data.name) return false;
      messages.push({
        kind: "tool",
        seq: event.seq,
        time: event.time,
        tool: {
          id: data.callId,
          name: data.name,
          arguments: data.arguments ?? "",
          status: "running",
          startedAt: event.time,
        },
      });
      return true;
    }
    case "tool/result": {
      const data = event.data as {
        message?: { content?: Array<{ type?: string; text?: string }> };
        error?: { name?: string; code?: string };
      };
      const callId = (data.message?.content?.[0] as { callId?: string } | undefined)?.callId;
      const resultText = data.message ? toolResultText(data.message) : "";
      // 反向找最后一条同 callId 的 tool 卡片
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.kind === "tool" && m.tool.id === callId) {
          const error = data.error
            ? { name: data.error.name ?? "ToolError", code: data.error.code ?? "UNKNOWN" }
            : undefined;
          messages[i] = {
            ...m,
            seq: event.seq,
            tool: {
              ...m.tool,
              status: error ? "error" : "done",
              result: data.message ? toolResultText(data.message) : "",
              error,
              endedAt: event.time,
            },
          };
          return true;
        }
      }
      return false;
    }
    case "turn/end": {
      const data = event.data as { reason?: { kind?: string } };
      // 标记最后一个未完成 assistant 卡片
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.kind === "assistant" && !m.finished) {
          messages[i] = {
            ...m,
            finished: true,
            reason: data.reason?.kind,
            endedAt: event.time,
            seq: event.seq,
          };
          return true;
        }
        if (m?.kind === "assistant") break;
      }
      return false;
    }
    default:
      return false;
  }
}

/** 全量回放：把事件数组折叠成消息列表。 */
export function projectEvents(events: readonly SessionEvent[]): MessageView[] {
  const messages: MessageView[] = [];
  for (const event of events) {
    applyEvent(messages, event);
  }
  return messages;
}

/** 从事件日志提取会话标题（最后一个 session/title 事件）。 */
export function titleFromEvents(events: readonly SessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e?.type as string) === "session/title") {
      const title = (e?.data as { title?: string } | undefined)?.title;
      if (title && title.trim() !== "") return title;
    }
  }
  return undefined;
}

/** 从事件日志统计消息数量 + 最后活跃时间。 */
export function sessionStats(events: readonly SessionEvent[]): { updatedAt: number; messageCount: number } {
  let updatedAt = 0;
  let messageCount = 0;
  for (const event of events) {
    if (event.time > updatedAt) updatedAt = event.time;
    if (event.type === "assistant/message") {
      messageCount++;
    } else if (event.type === "user/message") {
      const source = (event.data as { source?: unknown }).source;
      if (isUserProduced(source)) messageCount++;
    }
  }
  return { updatedAt, messageCount };
}

/**
 * 折叠一个会话的元信息（供侧边栏/会话列表）。
 * @param events 该会话的完整事件日志
 * @param fallbackFromFirstUser 没有标题时用首条用户消息兜底
 */
export function foldSessionMeta(
  id: string,
  createdAt: number,
  events: readonly SessionEvent[],
): SessionMeta {
  const title = titleFromEvents(events);
  const { updatedAt, messageCount } = sessionStats(events);
  let preset: string | undefined;
  for (const event of events) {
    // permission/preset 不在 SessionEvent 联合类型里（DSH 类型未同步），按未知事件处理
    if ((event as { type?: string }).type === "permission/preset") {
      const data = (event as unknown as { data?: { preset?: string } }).data;
      if (data?.preset) preset = data.preset;
    }
  }
  let fallback = "";
  if (!title) {
    for (const event of events) {
      if (event.type === "user/message") {
        const content = userTextFromMessage((event.data as { content?: Array<{ type?: string; text?: string }> }));
        const trimmed = content.replace(/\s+/g, " ").trim();
        if (trimmed !== "") {
          fallback = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
          break;
        }
      }
    }
  }
  return {
    id,
    title: title ?? fallback,
    createdAt,
    updatedAt: updatedAt || createdAt,
    messageCount,
    preset,
  };
}

/** 工具展示名（opencode 风格：Bash / Read / Edit ...）。 */
export function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    bash: "Bash",
    pwsh: "Pwsh",
    fs_read: "Read",
    fs_write: "Write",
    fs_edit: "Edit",
    fs_search: "Search",
    fs_list: "List",
    fs_glob: "Glob",
    grep: "Grep",
    web_search: "Web Search",
    web_fetch: "Fetch",
    todo: "Todo",
    goal: "Goal",
    skill: "Skill",
    subagent: "Task",
    subagent_fork: "Task",
    workflow: "Workflow",
    ralph: "Ralph",
    ask_user: "Ask",
    ask_user_question: "Ask",
    plan_mode: "Plan",
    compact: "Compact",
    jobs: "Jobs",
    bash_persistent: "Bash",
    str_replace_editor: "Edit",
    ls: "List",
    view: "View",
    glob: "Glob",
    write: "Write",
    edit: "Edit",
    fetch: "Fetch",
    patch: "Patch",
  };
  if (name in map) return map[name]!;
  // 去掉常见前缀后驼峰化
  const cleaned = name.replace(/^tool_/, "").replace(/^dsh_/, "");
  return cleaned
    .split(/[_-]/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** 工具进行中的动作文案（opencode 风格）。 */
export function toolAction(name: string): string {
  const map: Record<string, string> = {
    bash: "Building command...",
    pwsh: "Building command...",
    fs_read: "Reading file...",
    fs_write: "Preparing write...",
    fs_edit: "Preparing edit...",
    fs_search: "Searching content...",
    fs_list: "Listing directory...",
    fs_glob: "Finding files...",
    web_search: "Searching web...",
    web_fetch: "Writing fetch...",
    todo: "Updating todos...",
    goal: "Updating goal...",
    subagent: "Preparing prompt...",
    workflow: "Running workflow...",
    ralph: "Running ralph loop...",
    ask_user: "Asking you...",
    ask_user_question: "Asking you...",
    bash_persistent: "Building command...",
    ls: "Listing directory...",
    view: "Reading file...",
    glob: "Finding files...",
    grep: "Searching content...",
    write: "Preparing write...",
    edit: "Preparing edit...",
    fetch: "Writing fetch...",
    patch: "Preparing patch...",
  };
  return map[name] ?? "Working...";
}

/** 解析工具参数 JSON → 展示摘要（opencode 风格：主参数 + 键值对）。 */
export function toolParamSummary(name: string, argsJson: string, maxWidth: number): string {
  let input: unknown;
  try {
    input = JSON.parse(argsJson || "{}");
  } catch {
    return compactParam(argsJson.replace(/\n/g, " "), maxWidth);
  }
  if (typeof input !== "object" || input === null) return compactParam(argsJson.replace(/\n/g, " "), maxWidth);
  const obj = input as Record<string, unknown>;
  // 主参数：不同工具取不同字段
  const mainKey =
    name === "bash" || name === "bash_persistent"
      ? "command"
      : name === "fs_read" || name === "fs_write" || name === "fs_edit"
        ? "path"
        : name === "view" || name === "write" || name === "edit"
          ? "file_path"
          : name === "web_fetch" || name === "fetch"
            ? "url"
            : name === "grep" || name === "fs_search"
              ? "pattern"
              : name === "subagent" || name === "subagent_fork"
                ? "prompt"
                : name === "glob" || name === "fs_glob"
                  ? "pattern"
                  : name === "web_search"
                    ? "query"
                    : name === "ls" || name === "fs_list"
                      ? "path"
                      : name === "todo"
                        ? "todos"
                        : name === "ask_user" || name === "ask_user_question"
                          ? "question"
                          : "input";
  const main = obj[mainKey];
  const mainText = typeof main === "string" ? main.replace(/\n/g, " ") : typeof main === "number" ? String(main) : "";
  // 附加键值
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === mainKey) continue;
    if (v === undefined || v === null || v === "") continue;
    const vText = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (vText === "{}" || vText === "[]") continue;
    pairs.push(`${k}=${vText.replace(/\n/g, " ")}`);
  }
  if (pairs.length > 0) {
    const joined = `${mainText} (${pairs.join(", ")})`;
    return compactParam(joined, maxWidth);
  }
  return compactParam(mainText, maxWidth);
}

function compactParam(text: string, maxWidth: number): string {
  if (text === "") return "";
  // 保留 maxWidth 的宽度
  return truncateForWidth(text, maxWidth);
}

import { widthOf, truncate } from "./util.js";

function truncateForWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  return truncate(text, maxWidth);
}

/** 从结果文本里提取语法高亮语言标签（opencode 风格代码块）。 */
export function extOfPath(path: string): string {
  const ext = path.split(".").pop();
  if (!ext || ext === path) return "";
  return ext.toLowerCase();
}

/** 文件修改类工具（与 oc-server 的 FILE_TOOL_NAMES 一致）。 */
const FILE_TOOL_NAMES = new Set([
  "write",
  "edit",
  "rename",
  "move",
  "delete",
  "remove",
  "copy",
  "fs_write",
  "fs_edit",
  "fs_rename",
  "fs_move",
  "fs_delete",
  "fs_remove",
  "fs_copy",
  "str-replace-editor",
]);

/** 从会话事件流提取最后一条 todo 快照（opencode Todo 形状）。 */
export function todosFromEvents(events: readonly SessionEvent[]): Array<{ id: string; content: string; status: string; priority: string }> {
  let last: Array<{ content?: string; status?: string }> | undefined;
  for (const event of events) {
    if ((event as { type?: string }).type !== "todo/write") continue;
    const data = (event as unknown as { data?: unknown }).data;
    const list = Array.isArray(data) ? data : ((data as { todos?: unknown } | undefined)?.todos as Array<{ content?: string; status?: string }> | undefined);
    if (Array.isArray(list)) last = list;
  }
  if (!last) return [];
  return last.map((item) => ({
    id: `td_${Math.random().toString(36).slice(2, 10)}`,
    content: item.content ?? "",
    status: item.status ?? "pending",
    priority: "medium",
  }));
}

/** 从会话事件流提取修改过的文件（工具调用 → Modified Files 区）。 */
export function diffsFromEvents(events: readonly SessionEvent[]): Array<{ file: string; before: string; after: string; additions: number; deletions: number }> {
  const out: Array<{ file: string; before: string; after: string; additions: number; deletions: number }> = [];
  const seen = new Set<string>();
  for (const event of events) {
    if ((event as { type?: string }).type !== "tool/call") continue;
    const data = (event as unknown as { data?: { name?: string; arguments?: string } }).data;
    if (!data || !FILE_TOOL_NAMES.has(data.name ?? "")) continue;
    let args: Record<string, unknown> = {};
    try {
      args = data.arguments ? JSON.parse(data.arguments) : {};
    } catch {
      continue;
    }
    const file = (args.path ?? args.file_path ?? args.filePath ?? args.file) as string | undefined;
    if (typeof file === "string" && file.trim() && !seen.has(file)) {
      seen.add(file);
      out.push({ file, before: "", after: "", additions: 1, deletions: 0 });
    }
  }
  return out;
}
