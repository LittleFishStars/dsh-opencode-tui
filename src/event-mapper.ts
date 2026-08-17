/**
 * DSH 事件映射器：DSH session/event → opencode 旧协议事件。
 *
 * 从 oc-server.ts 拆出。职责：
 * - handleDshEvent：把 DSH 事件流（turn/start、assistant/chunk、tool/call、
 *   tool/result、assistant/message、turn/end、user/message …）映射为 TUI
 *   的消息/part/session 事件并推送
 * - handleApproval / handleQuestion：DSH 审批/提问 → TUI 权限/问题对话框
 * - 工具 part 构造与文件 diff 收集（侧边栏 Modified Files）
 *
 * 不持有会话存储本身，通过 SessionStore 访问会话状态与推送。
 */
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { ocId, type ModelRef } from "./oc-proto.js";
import type { SessionStore } from "./session-store.js";
import { FILE_TOOL_NAMES, type LegacyMessageInfo, type LegacyToolPart, type PendingAssistant, type PendingTool, type SessionState } from "./types.js";
import { toolDisplayName } from "./tool-display.js";
import { ocLog } from "./logging.js";

export interface DshEventMapperOptions {
  /** 会话级 todo 快照 → opencode Todo（侧边栏 Todo 区） */
  onTodos?: (state: SessionState, todos: Array<{ content?: string; status?: string }>) => void;
  /** 文件修改类工具调用 → 会话 diff 列表（侧边栏 Modified Files 区） */
  onDiff?: (state: SessionState, file: string) => void;
}

function userTextFromMessage(message: { content?: Array<{ type?: string; text?: string }> }): string {
  const blocks = message.content ?? [];
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function toolResultText(message: { content?: Array<{ type?: string; text?: string }> }): string {
  return userTextFromMessage(message);
}

export class DshEventMapper {
  private store: SessionStore;
  private opts: DshEventMapperOptions;

  constructor(store: SessionStore, opts: DshEventMapperOptions = {}) {
    this.store = store;
    this.opts = opts;
  }

  /** 由 plugin 在 ctx.on('session/event') 中调用。 */
  handleDshEvent(session: { id: string; title?: string }, event: SessionEvent): void {
    const state = this.store.findByDsh(session.id);
    if (!state) return;
    switch (event.type) {
      case "turn/start": {
        state.busy = true;
        state.updatedAt = Date.now();
        const sel = this.store.sessionModel(state) ?? { id: "model", providerID: "provider" };
        const pending: PendingAssistant = {
          messageId: ocId("msg"),
          agent: state.currentAgent,
          model: sel,
          startedAt: Date.now(),
          textBlocks: new Map(),
          reasoningBlocks: new Map(),
          tools: new Map(),
        };
        state.pending = pending;
        this.store.pushSessionEvent(state, {
          type: "session.status",
          properties: { sessionID: state.id, status: { type: "busy" } },
        });
        const info: LegacyMessageInfo = {
          id: pending.messageId,
          sessionID: state.id,
          role: "assistant",
          time: { created: pending.startedAt, updated: pending.startedAt },
          agent: state.currentAgent,
          model: { providerID: sel.providerID, modelID: sel.id },
          modelID: sel.id,
          providerID: sel.providerID,
          mode: "primary",
          path: { cwd: state.directory, root: state.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        };
        state.messages.push({ info, parts: [] });
        this.store.pushSessionEvent(state, {
          type: "message.updated",
          properties: { info },
        });
        break;
      }
      case "assistant/chunk": {
        const pending = state.pending;
        if (!pending) break;
        const data = event.data as {
          step?: number;
          chunk?: { type?: string; text?: string; id?: string; name?: string; arguments?: string; index?: number; blockType?: string; block?: { type?: string } };
        };
        const chunk = data.chunk;
        if (!chunk) break;
        const blockKey = (index?: number): string => `${data.step ?? 0}:${index ?? 0}`;
        const eventTime = event.time;
        if (chunk.type === "text-delta" && chunk.text) {
          // 文本也按块拆分：part id 分配顺序 = 内容出现顺序（TUI 按 id 排序渲染，
          // 思考/输出交替时必须保证 text part 排在对应 reasoning part 之后）
          const key = blockKey(chunk.index);
          let block = pending.textBlocks.get(key);
          if (!block) {
            block = { partId: ocId("prt"), text: "", start: eventTime };
            pending.textBlocks.set(key, block);
          }
          block.text += chunk.text;
          const msg = this.store.findMessage(state, pending.messageId);
          if (msg) {
            msg.info.time.updated = Date.now();
          }
          this.store.pushSessionEvent(state, {
            type: "message.part.updated",
            properties: { part: {
              id: block.partId,
              sessionID: state.id,
              messageID: pending.messageId,
              type: "text",
              text: block.text,
              time: { start: block.start },
            },
              delta: chunk.text,
            },
          });
        } else if (chunk.type === "reasoning-delta" && chunk.text) {
          // 追加到当前 step 的思考块（每块独立 part id，多次思考不合并）
          const key = blockKey(chunk.index);
          let block = pending.reasoningBlocks.get(key);
          if (!block) {
            block = { partId: ocId("prt"), text: "", start: eventTime };
            pending.reasoningBlocks.set(key, block);
          }
          block.text += chunk.text;
          this.store.pushSessionEvent(state, {
            type: "message.part.updated",
            properties: { part: {
              id: block.partId,
              sessionID: state.id,
              messageID: pending.messageId,
              type: "reasoning",
              text: block.text,
              time: { start: block.start },
            },
              delta: chunk.text,
            },
          });
        } else if (chunk.type === "block-start") {
          // 块边界（reasoning/text/tool-call）：块在首个 delta 时创建，
          // 这里预创建以记录准确的 start 时间（id 分配顺序与内容出现顺序一致）
          if (chunk.blockType === "reasoning") {
            const key = blockKey(chunk.index);
            if (!pending.reasoningBlocks.has(key)) {
              pending.reasoningBlocks.set(key, { partId: ocId("prt"), text: "", start: eventTime });
            }
          } else if (chunk.blockType === "text") {
            const key = blockKey(chunk.index);
            if (!pending.textBlocks.has(key)) {
              pending.textBlocks.set(key, { partId: ocId("prt"), text: "", start: eventTime });
            }
          }
        } else if (chunk.type === "tool-call-delta") {
          const callID = chunk.id ?? "call_unknown";
          let tool = pending.tools.get(callID);
          if (!tool) {
            tool = {
              callID,
              partId: ocId("prt"),
              name: chunk.name ?? "tool",
              state: { status: "running" },
              inputArgs: "",
              createdAt: Date.now(),
            };
            pending.tools.set(callID, tool);
            this.store.pushSessionEvent(state, {
              type: "message.part.updated",
              properties: { part: this.toolPart(state, pending, tool) },
            });
          }
          tool.inputArgs += chunk.arguments ?? "";
        } else if (chunk.type === "block-end") {
          // 块结束：reasoning 推最终 part 状态（time.end 停止 spinner 并变灰）
          const block = chunk.block;
          const now = eventTime;
          if (block?.type === "reasoning") {
            const key = blockKey(chunk.index);
            const rb = pending.reasoningBlocks.get(key);
            if (rb && rb.text) {
              rb.end = now;
              this.store.pushSessionEvent(state, {
                type: "message.part.updated",
                properties: {
                  part: {
                    id: rb.partId,
                    sessionID: state.id,
                    messageID: pending.messageId,
                    type: "reasoning",
                    text: rb.text,
                    time: { start: rb.start, end: now },
                  },
                },
              });
            }
          }
        }
        break;
      }
      case "tool/call": {
        const data = event.data as { callId?: string; name?: string; arguments?: string };
        const name = data.name ?? "tool";
        // 文件修改类工具 → 会话 Modified Files（侧边栏 Files 区；不依赖 pending）
        if (FILE_TOOL_NAMES.has(name)) {
          try {
            const args = data.arguments ? JSON.parse(data.arguments) : {};
            const file = (args.path ?? args.file_path ?? args.filePath ?? args.file ?? args.paths?.[0]) as string | undefined;
            if (typeof file === "string" && file.trim()) {
              if (!state.diffs.some((d) => d.file === file)) {
                state.diffs.push({ file, before: "", after: "", additions: 1, deletions: 0 });
                this.store.pushSessionEvent(state, {
                  type: "session.diff",
                  properties: { sessionID: state.id, diff: state.diffs },
                });
              }
            }
          } catch {
            /* arguments 解析失败不阻塞 */
          }
        }
        const pending = state.pending;
        if (!pending) break;
        const callID = data.callId ?? ocId("call");
        let tool = pending.tools.get(callID);
        if (!tool) {
          tool = {
            callID,
            partId: ocId("prt"),
            name,
            state: { status: "running" },
            inputArgs: "",
            createdAt: Date.now(),
          };
          pending.tools.set(callID, tool);
        }
        tool.name = name;
        let input: Record<string, unknown> = {};
        try {
          input = data.arguments ? JSON.parse(data.arguments) : {};
        } catch {
          input = { raw: data.arguments };
        }
        tool.state.input = input;
        this.store.pushSessionEvent(state, {
          type: "message.part.updated",
          properties: { part: this.toolPart(state, pending, tool) },
        });
        break;
      }
      case "tool/result": {
        const pending = state.pending;
        if (!pending) break;
        const data = event.data as {
          message?: { content?: Array<{ type?: string; text?: string }> };
          error?: { name?: string; code?: string };
        };
        const message = data.message;
        const callID = (message?.content?.[0] as { callId?: string } | undefined)?.callId ?? "call_unknown";
        const resultText = message ? toolResultText(message) : "";
        const tool = pending.tools.get(callID);
        if (tool) {
          // 对齐原版 ToolState：completed 必填 output + title；Shell 的展开
          // 依赖 state.metadata.output（点击展开工具输出），Execute 读 state.output
          const prevMeta = tool.state.metadata ?? {};
          tool.state = data.error || resultText.startsWith("Error:")
            ? { ...tool.state, status: "error", error: resultText || data.error?.name || "tool error", metadata: { ...prevMeta, output: resultText } }
            : {
                ...tool.state,
                status: "completed",
                output: resultText,
                title: toolDisplayName(tool.name),
                content: [{ type: "text", text: resultText }],
                result: resultText,
                metadata: { ...prevMeta, output: resultText },
              };
          this.store.pushSessionEvent(state, {
            type: "message.part.updated",
            properties: { part: this.toolPart(state, pending, tool) },
          });
        }
        break;
      }
      case "todo/write": {
        // DSH todo 快照 → opencode Todo（侧边栏 Todo 区）
        const data = event.data as { todos?: Array<{ content?: string; status?: string }> } | Array<{ content?: string; status?: string }>;
        const list = Array.isArray(data) ? data : data.todos;
        if (Array.isArray(list)) {
          state.todos = list.map((item) => ({
            id: `td_${Math.random().toString(36).slice(2, 10)}`,
            content: item.content ?? "",
            status: item.status ?? "pending",
            priority: "medium",
          }));
          this.store.pushSessionEvent(state, {
            type: "todo.updated",
            properties: { sessionID: state.id, todos: state.todos },
          });
        }
        break;
      }
      case "assistant/message": {
        // DSH 完成一条 assistant 消息：记录 usage（token 统计，供侧边栏/输入框 meta 显示）
        const pending = state.pending;
        if (pending) {
          const data = event.data as { usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } };
          const u = data.usage;
          if (u) {
            pending.tokens = {
              input: u.inputTokens ?? 0,
              output: u.outputTokens ?? 0,
              reasoning: u.reasoningTokens ?? 0,
              cacheRead: u.cacheReadTokens ?? 0,
              cacheWrite: u.cacheWriteTokens ?? 0,
            };
          }
        }
        break;
      }
      case "request/header": {
        // 记录模型上下文窗口（maxTokens），用于 limit.context 的百分比计算
        const data = event.data as { header?: { config?: { maxTokens?: number } } };
        const maxTokens = data.header?.config?.maxTokens;
        if (typeof maxTokens === "number" && maxTokens > 0) this.store.modelContext = maxTokens;
        break;
      }
      case "turn/end": {
        const pending = state.pending;
        if (pending) {
          const data = event.data as { reason?: { kind?: string } };
          const kind = data.reason?.kind;
          const finish = kind === "completed" ? "end_turn" : kind === "aborted" || kind === "interrupted" ? "canceled" : kind === "error" ? "error" : "end_turn";
          pending.finish = finish;
          pending.endedAt = Date.now();
          const msg = this.store.findMessage(state, pending.messageId);
          if (msg) {
            msg.info.time.updated = pending.endedAt;
            msg.info.time.completed = pending.endedAt;
            msg.info.finish = finish;
            // usage → tokens（侧边栏 Context/命中率、输入框 meta 行的数据源）
            if (pending.tokens) {
              const t = pending.tokens;
              msg.info.tokens = {
                input: t.input,
                output: t.output,
                reasoning: t.reasoning,
                cache: { read: t.cacheRead, write: t.cacheWrite },
              };
              msg.info.cost = 0;
            }
            if (!msg.info.parentID) {
              const userMsg = [...state.messages].reverse().find((m) => m.info.role === "user");
              msg.info.parentID = userMsg?.info.id;
            }
            msg.parts = [];
            // 文本块 + 思考块按创建顺序合并（Map 插入序 = part id 递增序 =
            // 真实时间顺序；TUI 按 id 排序渲染保证 思考1→输出1→思考2→输出2）
            const parts: Array<{ partId: string; type: "text" | "reasoning"; text: string; start: number; end?: number }> = [];
            for (const block of pending.textBlocks.values()) {
              if (!block.text) continue;
              parts.push({ partId: block.partId, type: "text", text: block.text, start: block.start, end: block.end ?? pending.endedAt });
            }
            for (const block of pending.reasoningBlocks.values()) {
              if (!block.text) continue;
              parts.push({ partId: block.partId, type: "reasoning", text: block.text, start: block.start, end: block.end ?? pending.endedAt });
            }
            parts.sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
            for (const part of parts) {
              msg.parts.push({
                id: part.partId,
                sessionID: state.id,
                messageID: pending.messageId,
                type: part.type,
                text: part.text,
                time: { start: part.start, end: part.end },
              });
            }
            for (const tool of pending.tools.values()) {
              msg.parts.push(this.toolPart(state, pending, tool));
            }
            // 推最终 part 状态（time.end 使 reasoning/text 的 spinner 停止、变灰）
            for (const part of parts) {
              this.store.pushSessionEvent(state, {
                type: "message.part.updated",
                properties: {
                  part: {
                    id: part.partId,
                    sessionID: state.id,
                    messageID: pending.messageId,
                    type: part.type,
                    text: part.text,
                    time: { start: part.start, end: part.end },
                  },
                },
              });
            }
            this.store.pushSessionEvent(state, {
              type: "message.updated",
              properties: { info: msg.info },
            });
          }
          state.pending = undefined;
        }
        state.busy = false;
        state.updatedAt = Date.now();
        this.store.pushSessionEvent(state, {
          type: "session.status",
          properties: { sessionID: state.id, status: { type: "idle" } },
        });
        // 会话级 token/cost 聚合变化（侧边栏 Context 区刷新）
        this.store.touchSession(state);
        break;
      }
      case "user/message": {
        const data = event.data as { content?: Array<{ type?: string; text?: string }>; source?: { kind?: string } };
        const text = userTextFromMessage(data);
        if (!text.trim()) break;
        // 过滤系统注入：runtime context / sandbox 快照等（plugin 来源）不进消息列表
        if (data.source && data.source.kind !== "user") break;
        const now = Date.now();
        // 去重：用户消息已由 POST /session/:id/message 添加（同文本、时间接近时跳过）
        const lastUser = [...state.messages].reverse().find((m) => m.info.role === "user");
        if (lastUser && now - lastUser.info.time.created < 5000) {
          const lastText = (lastUser.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text;
          if (lastText === text) break;
        }
        const messageId = ocId("msg");
        const partId = ocId("prt");
        const sel = this.store.sessionModel(state);
        const info: LegacyMessageInfo = {
          id: messageId,
          sessionID: state.id,
          role: "user",
          time: { created: now, updated: now },
          agent: state.currentAgent,
          model: { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" },
        };
        state.messages.push({
          info,
          parts: [
            {
              id: partId,
              sessionID: state.id,
              messageID: messageId,
              type: "text",
              text,
              time: { start: now, end: now },
            },
          ],
        });
        this.store.pushSessionEvent(state, {
          type: "message.updated",
          properties: { info },
        });
        this.store.pushSessionEvent(state, {
          type: "message.part.updated",
          properties: {
            part: {
              id: partId,
              sessionID: state.id,
              messageID: messageId,
              type: "text",
              text,
              time: { start: now, end: now },
            },
          },
        });
        break;
      }
      default: {
        if (event.type === "session/title") {
          const data = (event as unknown as { data?: { title?: string } }).data;
          if (data?.title) {
            state.title = data.title;
            this.store.pushSessionEvent(state, {
              type: "session.updated",
              properties: { info: this.store.infoOf(state) },
            });
          }
        }
        break;
      }
    }
  }

  /** DSH approval/request → opencode permission 对话框；返回决议结果。 */
  handleApproval(
    dshSessionId: string,
    request: { toolName: string; callId?: string; reason?: string },
  ): Promise<"allowed-once" | "rejected"> | undefined {
    const state = this.store.findByDsh(dshSessionId);
    if (!state) return undefined;
    const permissionID = `perm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const lastMsg = [...state.messages].reverse().find((m) => m.info.role === "assistant");
    const permission = {
      id: permissionID,
      sessionID: state.id,
      permission: request.toolName,
      patterns: [] as string[],
      metadata: { reason: request.reason ?? "", title: `Allow ${request.toolName}?` },
      always: [] as string[],
      ...(request.callId ? { tool: { messageID: lastMsg?.info.id ?? "", callID: request.callId } } : {}),
    };
    return new Promise((resolve) => {
      state.permissions.set(permissionID, resolve);
      this.store.pushSessionEvent(state, {
        type: "permission.asked",
        properties: permission,
      });
      // 超时兜底：30s 无应答按拒绝（fail-closed）
      setTimeout(() => {
        const pending = state.permissions.get(permissionID);
        if (pending) {
          state.permissions.delete(permissionID);
          pending("rejected");
        }
      }, 30_000).unref?.();
    });
  }

  /** DSH user question → opencode question 对话框；返回应答（labels 按问题顺序）。 */
  handleQuestion(
    dshSessionId: string,
    items: Array<{ id: string; question: string; detail?: string; header?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>,
  ): Promise<unknown> | undefined {
    const state = this.store.findByDsh(dshSessionId);
    if (!state) {
      ocLog(`[oc-server] question: no session for ${dshSessionId}`);
      return undefined;
    }
    ocLog(`[oc-server] question: ${items.length} item(s) for ${state.id}`);
    const requestID = `ques_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    // 对齐 opencode v2 schema：QuestionInfo {question, header, options, multiple?, custom?}，
    // QuestionOption {label, description}。DSH 的 detail → 并入 question（原版无 detail 字段）。
    const questions = items.map((item) => ({
      question: item.detail ? `${item.question}\n\n${item.detail}` : item.question,
      header: item.header ?? item.question.slice(0, 30),
      ...(item.options && item.options.length > 0
        ? { options: item.options.map((o) => ({ label: o.label, description: o.description ?? "" })) }
        : {}),
      ...(item.multiSelect ? { multiple: true } : {}),
    }));
    // 消息流里的提问工具卡（原版 ask_user_question 工具："Asking questions..." → "Asked N questions"）
    const toolCallId = `call_question_${Date.now().toString(36)}`;
    const toolPartId = ocId("prt");
    const pending = state.pending;
    const toolPart: LegacyToolPart = {
      id: toolPartId,
      sessionID: state.id,
      messageID: pending?.messageId ?? state.messages.at(-1)?.info.id ?? "",
      type: "tool",
      tool: "question",
      state: {
        status: "running",
        input: { questions },
        content: [],
      },
      callID: toolCallId,
      time: { start: Date.now(), end: Date.now() },
    };
    if (pending) {
      pending.tools.set(toolCallId, {
        callID: toolCallId,
        partId: toolPartId,
        name: "question",
        state: toolPart.state,
        inputArgs: "",
        createdAt: Date.now(),
      });
      const msg = this.store.findMessage(state, pending.messageId);
      msg?.parts.push(toolPart);
    } else {
      const last = state.messages.at(-1);
      if (last?.info.role === "assistant") last.parts.push(toolPart);
    }
    this.store.pushSessionEvent(state, {
      type: "message.part.updated",
      properties: { part: toolPart },
    });
    return new Promise((resolve) => {
      state.questions.set(requestID, (rawAnswers: unknown) => {
        const labels = Array.isArray(rawAnswers) ? (rawAnswers as unknown[]) : [];
        const answers = items.map((item, i) => ({
          id: item.id,
          selected: Array.isArray(labels[i]) ? (labels[i] as string[]) : [],
        }));
        // 更新工具卡状态（metadata.answers → TUI 显示 "Asked N questions" + 答案）
        if (pending) {
          const tool = pending.tools.get(toolCallId);
          if (tool) {
            tool.state = {
              ...tool.state,
              status: "completed",
              metadata: { answers: labels.map((l) => (Array.isArray(l) ? l : [])) },
            };
            this.store.pushSessionEvent(state, {
              type: "message.part.updated",
              properties: { part: this.toolPart(state, pending, tool) },
            });
          }
        }
        resolve({ answers });
      });
      this.store.pushSessionEvent(state, {
        type: "question.asked",
        properties: { id: requestID, sessionID: state.id, questions },
      });
      // 超时兜底：60s 无应答按空答案结算
      setTimeout(() => {
        const pendingTimeout = state.questions.get(requestID);
        if (pendingTimeout) {
          state.questions.delete(requestID);
          pendingTimeout({ answers: [] });
        }
      }, 60_000).unref?.();
    });
  }

  /** 工具 part 构造（DSH 工具状态 → opencode tool part）。 */
  private toolPart(state: SessionState, pending: PendingAssistant, tool: PendingTool): LegacyToolPart {
    return {
      id: tool.partId,
      sessionID: state.id,
      messageID: pending.messageId,
      type: "tool",
      tool: tool.name,
      state: tool.state,
      callID: tool.callID,
      time: { start: tool.createdAt, end: Date.now() },
    };
  }
}
