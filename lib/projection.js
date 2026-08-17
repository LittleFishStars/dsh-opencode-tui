import { ocId } from "./oc-proto.js";
/** 从事件里取用户消息文本（text 块拼接）。 */
function userTextFromMessage(message) {
    const blocks = message.content ?? [];
    return blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
}
function assistantTextFromMessage(message) {
    return userTextFromMessage(message);
}
function toolResultText(message) {
    return userTextFromMessage(message);
}
/** 判断一条用户消息是否来自真实用户（过滤 injected context）。 */
function isUserProduced(source) {
    if (typeof source !== "object" || source === null)
        return true;
    const kind = source.kind;
    return kind === undefined || kind === "user";
}
/**
 * 增量投影：把单个会话事件应用到消息列表上。
 * 返回是否产生了可见变化。
 */
export function applyEvent(messages, event) {
    switch (event.type) {
        case "user/message": {
            const data = event.data;
            if (!isUserProduced(data.source))
                return false;
            const content = userTextFromMessage(data);
            // 空白注入不展示
            if (content.trim() === "")
                return false;
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
            const data = event.data;
            const chunk = data.chunk;
            if (!chunk)
                return false;
            // 块 key：DSH 每 step 的块索引从 0 重新编号，跨 step 必须区分
            const blockKey = (index) => `${data.step ?? 0}:${index ?? 0}`;
            // 追加内容到卡片：同 kind 且同 key 的连续 delta 追加到最后一个块，
            // 否则新建块（contentBlocks 按事件顺序排列，text/reasoning 交错不错序）
            const appendBlock = (card, kind, text) => {
                const blocks = card.contentBlocks ?? [];
                const key = blockKey(chunk.index);
                const last = blocks[blocks.length - 1];
                if (last && last.kind === kind && last.key === key) {
                    const updated = [...blocks];
                    updated[updated.length - 1] = { ...last, text: last.text + text };
                    return { ...card, text: kind === "text" ? card.text + text : card.text, thinking: kind === "reasoning" ? card.thinking + text : card.thinking, contentBlocks: updated, seq: event.seq };
                }
                return { ...card, text: kind === "text" ? card.text + text : card.text, thinking: kind === "reasoning" ? card.thinking + text : card.thinking, contentBlocks: [...blocks, { kind, key, text }], seq: event.seq };
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
                if (chunk.type === "block-end" && chunk.text) {
                    // 兼容直接把文本放在 block-end 的适配器
                    messages[messages.length - 1] = appendBlock(last, "text", chunk.text);
                    return true;
                }
            }
            else if (chunk.type === "text-delta" && chunk.text) {
                // 流式起点：还没有 assistant 卡片时创建一张
                messages.push({
                    kind: "assistant",
                    seq: event.seq,
                    id: `assistant-${event.seq}`,
                    time: event.time,
                    text: chunk.text,
                    thinking: "",
                    contentBlocks: [{ kind: "text", key: blockKey(chunk.index), text: chunk.text }],
                    assembled: false,
                    finished: false,
                });
                return true;
            }
            else if (chunk.type === "reasoning-delta" && chunk.text) {
                messages.push({
                    kind: "assistant",
                    seq: event.seq,
                    id: `assistant-${event.seq}`,
                    time: event.time,
                    text: "",
                    thinking: chunk.text,
                    contentBlocks: [{ kind: "reasoning", key: blockKey(chunk.index), text: chunk.text }],
                    assembled: false,
                    finished: false,
                });
                return true;
            }
            return false;
        }
        case "assistant/message": {
            const data = event.data;
            const message = data.message;
            if (!message)
                return false;
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
            const data = event.data;
            if (!data.callId || !data.name)
                return false;
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
            const data = event.data;
            const callId = data.message?.content?.[0]?.callId;
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
            const data = event.data;
            // 标记本轮所有未完成 assistant 卡片——工具轮会产生多条 assistant 卡片
            // （思考+工具调用 → 工具结果 → 最终回复），中间卡片的 endedAt 若缺失，
            // 重启 hydrate 后 reasoning part 没有 time.end，TUI 会一直显示 Thinking 转圈。
            // 遇 user 消息或已 finished 卡片即停（不跨轮次）。
            let changed = false;
            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (!m || m.kind === "user")
                    break;
                if (m.kind !== "assistant")
                    continue;
                if (m.finished)
                    break;
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
export function projectEvents(events) {
    const messages = [];
    for (const event of events) {
        applyEvent(messages, event);
    }
    return messages;
}
/** 从事件日志提取会话标题（最后一个 session/title 事件）。 */
export function titleFromEvents(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e?.type === "session/title") {
            const title = e?.data?.title;
            if (title && title.trim() !== "")
                return title;
        }
    }
    return undefined;
}
/** 从事件日志统计消息数量 + 最后活跃时间。 */
export function sessionStats(events) {
    let updatedAt = 0;
    let messageCount = 0;
    for (const event of events) {
        if (event.time > updatedAt)
            updatedAt = event.time;
        if (event.type === "assistant/message") {
            messageCount++;
        }
        else if (event.type === "user/message") {
            const source = event.data.source;
            if (isUserProduced(source))
                messageCount++;
        }
    }
    return { updatedAt, messageCount };
}
/**
 * 折叠一个会话的元信息（供侧边栏/会话列表）。
 * @param events 该会话的完整事件日志
 * @param fallbackFromFirstUser 没有标题时用首条用户消息兜底
 */
export function foldSessionMeta(id, createdAt, events) {
    const title = titleFromEvents(events);
    const { updatedAt, messageCount } = sessionStats(events);
    let preset;
    for (const event of events) {
        // permission/preset 不在 SessionEvent 联合类型里（DSH 类型未同步），按未知事件处理
        if (event.type === "permission/preset") {
            const data = event.data;
            if (data?.preset)
                preset = data.preset;
        }
    }
    let fallback = "";
    if (!title) {
        for (const event of events) {
            if (event.type === "user/message") {
                const content = userTextFromMessage(event.data);
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
export function todosFromEvents(events) {
    let last;
    for (const event of events) {
        if (event.type !== "todo/write")
            continue;
        const data = event.data;
        const list = Array.isArray(data) ? data : data?.todos;
        if (Array.isArray(list))
            last = list;
    }
    if (!last)
        return [];
    return last.map((item) => ({
        id: `td_${Math.random().toString(36).slice(2, 10)}`,
        content: item.content ?? "",
        status: item.status ?? "pending",
        priority: "medium",
    }));
}
/** 从会话事件流提取修改过的文件（工具调用 → Modified Files 区）。 */
export function diffsFromEvents(events) {
    const out = [];
    const seen = new Set();
    for (const event of events) {
        if (event.type !== "tool/call")
            continue;
        const data = event.data;
        if (!data || !FILE_TOOL_NAMES.has(data.name ?? ""))
            continue;
        let args = {};
        try {
            args = data.arguments ? JSON.parse(data.arguments) : {};
        }
        catch {
            continue;
        }
        const file = (args.path ?? args.file_path ?? args.filePath ?? args.file);
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
export function viewsToLegacyMessages(sessionID, views, sel, agent) {
    const out = [];
    const model = { providerID: sel?.providerID ?? "provider", modelID: sel?.id ?? "model" };
    let currentAssistant;
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
        }
        else if (v.kind === "assistant") {
            const info = {
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
            const parts = [];
            // 文本块 + 思考块合并，按块顺序输出（思考→输出→再思考→再输出 保持真实顺序）。
            // hydrate 时 TUI 的 sync 按 part id 字典序渲染（与 live 一致），
            // 因此各块 id 的分配顺序必须与块的出现顺序一致：先 text 后 reasoning 会错序，
            // 这里按"块在事件流中的顺序"生成 id——文本块和思考块交替出现时用
            // 统一的递增 id 保证字典序 = 真实顺序。
            // 内容块（text/reasoning 交错，按事件顺序）→ 各自独立 part。
            // 旧会话无 contentBlocks 时回退：thinking + text（先后未知，text 在前兼容历史）
            const blocks = v.contentBlocks && v.contentBlocks.length > 0
                ? v.contentBlocks.filter((b) => b.text).map((b) => ({ kind: b.kind, text: b.text }))
                : [...(v.text ? [{ kind: "text", text: v.text }] : []), ...(v.thinking ? [{ kind: "reasoning", text: v.thinking }] : [])];
            for (const block of blocks) {
                parts.push({ id: ocId("prt"), sessionID, messageID: v.id, type: block.kind, text: block.text, time: { start: v.time, end: v.endedAt } });
            }
            currentAssistant = { info, parts };
            out.push(currentAssistant);
        }
        else if (v.kind === "tool" && currentAssistant) {
            // 工具卡归入当前 assistant 消息的 parts
            // id 用独立 prt_ part id（TUI 按 part id 排序渲染；DSH callId 保留在 callID）
            const t = v.tool;
            currentAssistant.parts.push({
                id: ocId("prt"),
                sessionID,
                messageID: currentAssistant.info.id,
                type: "tool",
                tool: t.name,
                state: {
                    status: t.status === "error" ? "error" : t.status === "done" ? "completed" : "running",
                    input: safeParseToolArgs(t.arguments),
                    content: t.result ? [{ type: "text", text: t.result }] : [],
                    result: t.result,
                    error: t.error ? t.error.name : undefined,
                },
                callID: t.id,
                time: { start: t.startedAt, end: t.endedAt },
            });
        }
    }
    return out;
}
function safeParseToolArgs(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=projection.js.map