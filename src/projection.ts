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
import { ocId } from "./oc-proto.js";
import { toolDisplayName } from "./tool-display.js";
import type { LegacyMessage, LegacyMessageInfo, LegacyPart } from "./types.js";

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
  /** 思考（reasoning）文本（旧字段，全部块拼接；新代码用 contentBlocks） */
  thinking: string;
  /** 内容块（text/reasoning 交错出现，按事件顺序排列；思考/输出交替时
   *  保持 part 顺序，多次思考各自独立不合并）。旧会话无此字段时回退 thinking/text。 */
  contentBlocks?: Array<{ kind: "text" | "reasoning"; key: string; text: string; start?: number; end?: number }>;
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
      const data = event.data as { step?: number; chunk?: { type?: string; text?: string; index?: number; blockType?: string; block?: { type?: string } } };
      const chunk = data.chunk;
      if (!chunk) return false;
      // 块 key：DSH 每 step 的块索引从 0 重新编号，跨 step 必须区分
      const blockKey = (index?: number): string => `${data.step ?? 0}:${index ?? 0}`;
      // 追加内容到卡片：同 kind 且同 key 的连续 delta 追加到最后一个块，
      // 否则新建块（contentBlocks 按事件顺序排列，text/reasoning 交错不错序）
      const appendBlock = (card: AssistantMessageView, kind: "text" | "reasoning", text: string): AssistantMessageView => {
        const blocks = card.contentBlocks ?? [];
        const key = blockKey(chunk.index);
        const last = blocks[blocks.length - 1];
        if (last && last.kind === kind && last.key === key) {
          const updated = [...blocks];
          updated[updated.length - 1] = { ...last, text: last.text + text };
          return { ...card, text: kind === "text" ? card.text + text : card.text, thinking: kind === "reasoning" ? card.thinking + text : card.thinking, contentBlocks: updated, seq: event.seq };
        }
        // 新块：记录 start 时间（每块自己的时间，hydrate 后思考时长不被整轮拉长）
        return { ...card, text: kind === "text" ? card.text + text : card.text, thinking: kind === "reasoning" ? card.thinking + text : card.thinking, contentBlocks: [...blocks, { kind, key, text, start: event.time }], seq: event.seq };
      };
      // 块结束：更新对应块的 end 时间（block-end 事件携带 index）
      const closeBlock = (card: AssistantMessageView, kind: "text" | "reasoning"): AssistantMessageView => {
        const blocks = card.contentBlocks ?? [];
        const key = blockKey(chunk.index);
        const idx = blocks.findLastIndex((b: { kind: string; key: string }) => b.kind === kind && b.key === key) ?? -1;
        if (idx === -1) return card;
        const updated = [...blocks];
        const target = updated[idx];
        if (!target) return card;
        updated[idx] = { ...target, end: event.time };
        return { ...card, contentBlocks: updated, seq: event.seq };
      };
      const last = messages[messages.length - 1];
      // 只追加到"当前"assistant 卡片（最后一个 assistant 且未 assembled）
      if (last?.kind === "assistant" && !last.assembled) {
        if (chunk.type === "text-delta" && chunk.text) {
          messages[messages.length - 1] = appendBlock(last, "text", chunk.text);
          return true;
        }
        if (chunk.type === "reasoning-delta" && chunk.text) {
          messages[messages.length - 1] = appendBlock(last, "reasoning", chunk.text);
          return true;
        }
        if (chunk.type === "block-end") {
          // 关闭对应块（记录 end 时间）；兼容直接把文本放在 block-end 的适配器
          const blockType = (chunk as { block?: { type?: string } }).block?.type;
          let card = last;
          if (blockType === "reasoning") {
            card = closeBlock(last, "reasoning");
          } else if (blockType === "text") {
            card = closeBlock(last, "text");
          }
          if (chunk.text) card = appendBlock(card, "text", chunk.text);
          messages[messages.length - 1] = card;
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
          contentBlocks: [{ kind: "text", key: blockKey(chunk.index), text: chunk.text, start: event.time }],
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
          contentBlocks: [{ kind: "reasoning", key: blockKey(chunk.index), text: chunk.text, start: event.time }],
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
        // （reasoning 随消息落地结束，endedAt 保证重启后 reasoning part 有 time.end）
        messages[messages.length - 1] = {
          ...last,
          text,
          assembled: true,
          endedAt: last.endedAt ?? event.time,
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
        contentBlocks: [],
        assembled: true,
        finished: false,
        endedAt: event.time,
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
        message?: {
          source?: { callId?: string };
          content?: Array<{
            type?: string;
            callId?: string;
            toolCallId?: string;
            isError?: boolean;
            content?: Array<{ type?: string; text?: string }> | string;
            text?: string;
          }>;
        };
        error?: { name?: string; code?: string };
      };
      const message = data.message;
      // DSH tool/result 的 message.content[0] 是 {type:"tool-result", toolCallId,
      // content:[{type:"text",text}], isError}；callId 也可能在 source.callId
      const first = message?.content?.[0];
      const callId =
        first?.callId ??
        first?.toolCallId ??
        message?.source?.callId ??
        (message?.content?.find((c) => c.callId || c.toolCallId) as { callId?: string; toolCallId?: string } | undefined)?.callId ??
        (message?.content?.find((c) => c.callId || c.toolCallId) as { callId?: string; toolCallId?: string } | undefined)?.toolCallId;
      // 结果文本：优先 tool-result 块的嵌套 content，回退顶层 text 块
      const resultText = (() => {
        if (first?.type === "tool-result") {
          if (Array.isArray(first.content)) {
            return first.content
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string)
              .join("");
          }
          if (typeof first.content === "string") return first.content;
          return first.text ?? "";
        }
        return message ? toolResultText(message) : "";
      })();
      const failed = Boolean(data.error) || Boolean(first?.isError);
      // 反向找最后一条同 callId 的 tool 卡片
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.kind === "tool" && m.tool.id === callId) {
          const error = data.error || failed
            ? { name: data.error?.name ?? "ToolError", code: data.error?.code ?? "UNKNOWN" }
            : undefined;
          messages[i] = {
            ...m,
            seq: event.seq,
            tool: {
              ...m.tool,
              status: error ? "error" : "done",
              result: resultText,
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
      // 标记本轮所有未完成 assistant 卡片——工具轮会产生多条 assistant 卡片
      // （思考+工具调用 → 工具结果 → 最终回复），中间卡片的 endedAt 若缺失，
      // 重启 hydrate 后 reasoning part 没有 time.end，TUI 会一直显示 Thinking 转圈。
      // 遇 user 消息或已 finished 卡片即停（不跨轮次）。
      let changed = false;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m || m.kind === "user") break;
        if (m.kind !== "assistant") continue;
        if (m.finished) break;
        messages[i] = {
          ...m,
          finished: true,
          reason: data.reason?.kind,
          // 已由 assistant/message 落地时间兜底的卡片保留更精确的时间
          endedAt: m.endedAt ?? event.time,
          seq: event.seq,
        };
        changed = true;
      }
      return changed;
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

// ── 消息视图 → 旧协议消息 ──────────────────────────────────────────────────

/**
 * MessageView[] → 旧协议消息列表（user/assistant/tool 卡）。
 * 供会话 hydrate（重启恢复）时把投影视图转成 TUI 能消费的消息形状。
 */
export function viewsToLegacyMessages(
  sessionID: string,
  views: readonly MessageView[],
  sel: { providerID?: string; id?: string } | undefined,
  agent: string,
): LegacyMessage[] {
  const out: LegacyMessage[] = [];
  const model = { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" };
  let currentAssistant: LegacyMessage | undefined;
  for (const v of views) {
    if (v.kind === "user") {
      out.push({
        info: {
          id: v.id,
          sessionID,
          role: "user",
          time: { created: v.time, updated: v.time },
          agent,
          model,
        },
        parts: [
          { id: ocId("prt"), sessionID, messageID: v.id, type: "text", text: v.content, time: { start: v.time, end: v.time } },
        ],
      });
    } else if (v.kind === "assistant") {
      const info: LegacyMessageInfo = {
        id: v.id,
        sessionID,
        role: "assistant",
        time: { created: v.time, updated: v.endedAt ?? v.time, completed: v.endedAt },
        agent,
        model,
        parentID: out.findLast((m) => m.info.role === "user")?.info.id,
        modelID: v.provider ? v.model : sel?.id,
        providerID: v.provider,
        mode: "primary",
        path: { cwd: "", root: "" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: v.finished ? (v.reason === "completed" ? "end_turn" : v.reason === "aborted" || v.reason === "interrupted" ? "canceled" : "error") : undefined,
      };
      const parts: LegacyPart[] = [];
      // 文本块 + 思考块合并，按块顺序输出（思考→输出→再思考→再输出 保持真实顺序）。
      // hydrate 时 TUI 的 sync 按 part id 字典序渲染（与 live 一致），
      // 因此各块 id 的分配顺序必须与块的出现顺序一致：先 text 后 reasoning 会错序，
      // 这里按"块在事件流中的顺序"生成 id——文本块和思考块交替出现时用
      // 统一的递增 id 保证字典序 = 真实顺序。
      // 内容块（text/reasoning 交错，按事件顺序）→ 各自独立 part。
      // 每块用自己的 start/end 时间（思考时长不被整轮拉长）；旧数据无块时间时
      // 回退 v.time / v.endedAt。
      // 旧会话无 contentBlocks 时回退：thinking + text（先后未知，text 在前兼容历史）
      const blocks: Array<{ kind: "text" | "reasoning"; text: string; start: number; end: number }> = v.contentBlocks && v.contentBlocks.length > 0
        ? v.contentBlocks.filter((b) => b.text).map((b) => ({
            kind: b.kind,
            text: b.text,
            start: b.start ?? v.time,
            end: b.end ?? v.endedAt ?? v.time,
          }))
        : [...(v.text ? [{ kind: "text" as const, text: v.text }] : []), ...(v.thinking ? [{ kind: "reasoning" as const, text: v.thinking }] : [])].map((b) => ({ ...b, start: v.time, end: v.endedAt ?? v.time }));
      for (const block of blocks) {
        parts.push({ id: ocId("prt"), sessionID, messageID: v.id, type: block.kind, text: block.text, time: { start: block.start, end: block.end } });
      }
      currentAssistant = { info, parts };
      out.push(currentAssistant);
    } else if (v.kind === "tool" && currentAssistant) {
      // 工具卡归入当前 assistant 消息的 parts
      // id 用独立 prt_ part id（TUI 按 part id 排序渲染；DSH callId 保留在 callID）
      const t = v.tool;
      const result = t.result ?? "";
      const completed = t.status === "done";
      currentAssistant.parts.push({
        id: ocId("prt"),
        sessionID,
        messageID: currentAssistant.info.id,
        type: "tool",
        tool: t.name,
        state: {
          status: t.status === "error" ? "error" : completed ? "completed" : "running",
          input: safeParseToolArgs(t.arguments),
          // completed 必填 output+title；metadata.output 供 Shell 点击展开；
          // time 必填（Read 组件读 state.time.compacted）
          ...(completed ? { output: result, title: toolDisplayName(t.name) } : {}),
          metadata: { ...(t.result ? { output: result } : {}) },
          content: t.result ? [{ type: "text", text: t.result }] : [],
          result: t.result,
          error: t.error ? t.error.name : undefined,
          time: { start: t.startedAt, end: t.endedAt },
        },
        callID: t.id,
        time: { start: t.startedAt, end: t.endedAt },
      });
    }
  }
  return out;
}

function safeParseToolArgs(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
