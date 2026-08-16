import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * 单条消息渲染（opencode 风格）：
 * - 用户消息：左侧粗边框 + 次要色（蓝）
 * - 助手消息：左侧粗边框 + 主色（橙），markdown，完成时附 "(model · took)"
 * - 工具调用：左侧粗边框 + 弱化色，`Name: params` 头 + 结果体
 */
import React from "react";
import { Box, Text } from "ink";
import { toolAction, toolDisplayName, toolParamSummary } from "../projection.js";
import { formatDuration, truncate } from "../util.js";
import { AnsiInline } from "../ansi.js";
import { Markdown } from "../markdown.js";
import { SPINNER_FRAMES } from "../util.js";
export const MAX_RESULT_HEIGHT = 10;
/** 消息内边距：左边框 + 内容 padding。 */
export const MSG_BORDER = 1;
export const MSG_PADDING = 1;
/** 消息可用文本宽度。 */
export function msgTextWidth(areaWidth) {
    return Math.max(10, areaWidth - MSG_BORDER - MSG_PADDING - 2);
}
// ── 工具结果渲染（opencode 风格） ──────────────────────────────────────────
function renderToolResult(tool, theme, width) {
    if (tool.status === "error") {
        const errText = tool.error ? `${tool.error.name}: ${tool.error.code}` : "Error";
        const content = tool.result ? truncate(tool.result.replace(/\n/g, " "), width, "...") : "";
        return (_jsxs(Text, { color: theme.error, children: [errText, content ? `: ${content}` : ""] }));
    }
    const result = tool.result ?? "";
    switch (tool.name) {
        case "bash":
        case "bash_persistent":
        case "pwsh": {
            const lines = truncateLines(result, MAX_RESULT_HEIGHT);
            return (_jsxs(Box, { flexDirection: "column", children: [lines.map((line, i) => (_jsx(AnsiInline, { text: line, color: theme.text }, i))), moreNote(result, theme)] }));
        }
        case "fs_read":
        case "fs_write":
        case "fs_edit":
        case "view":
        case "write":
        case "edit":
        case "patch": {
            // 按扩展名高亮的代码块
            const lang = detectLang(tool);
            const lines = truncateLines(result, MAX_RESULT_HEIGHT);
            return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 1, children: [lines.map((line, i) => (_jsx(Text, { color: theme.text, children: line || " " }, i))), moreNote(result, theme)] }));
        }
        case "fs_search":
        case "fs_list":
        case "fs_glob":
        case "grep":
        case "ls":
        case "glob":
            return (_jsxs(Box, { flexDirection: "column", children: [truncateLines(result, MAX_RESULT_HEIGHT).map((line, i) => (_jsx(Text, { color: theme.textMuted, children: line }, i))), moreNote(result, theme)] }));
        default:
            return (_jsxs(Box, { flexDirection: "column", children: [truncateLines(result, MAX_RESULT_HEIGHT).map((line, i) => (_jsx(AnsiInline, { text: line, color: theme.text }, i))), moreNote(result, theme)] }));
    }
}
function detectLang(tool) {
    let path = "";
    try {
        const args = JSON.parse(tool.arguments || "{}");
        path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
    }
    catch {
        /* ignore */
    }
    const ext = path.split(".").pop();
    if (!ext || ext === path)
        return "";
    return ext.toLowerCase();
}
function truncateLines(text, max) {
    const lines = text.split("\n");
    if (lines.length > max)
        return lines.slice(0, max);
    return lines;
}
function moreNote(text, theme) {
    const lines = text.split("\n");
    if (lines.length <= MAX_RESULT_HEIGHT)
        return null;
    return _jsxs(Text, { color: theme.textMuted, children: ["\u2026 +", lines.length - MAX_RESULT_HEIGHT, " more lines"] });
}
// ── 消息体 ──────────────────────────────────────────────────────────────────
function UserBody({ view, theme, width }) {
    return (_jsx(Box, { flexDirection: "column", width: width, children: _jsx(Markdown, { md: view.content, theme: theme, width: width }) }));
}
/** 思考内容字符数（人类可读）。 */
function charsLabel(n) {
    if (n < 1000)
        return `${n} chars`;
    return `${(n / 1000).toFixed(1)}k chars`;
}
function AssistantBody({ view, theme, width, expanded, }) {
    const text = view.text;
    const hasThinking = view.thinking !== "";
    const infoParts = [];
    if (view.finished) {
        const model = view.model ? view.model.split("/").pop() : undefined;
        const took = view.endedAt && view.time ? formatDuration(view.time, view.endedAt) : undefined;
        const reasonLabel = view.reason === "completed"
            ? undefined
            : view.reason === "aborted"
                ? "canceled"
                : view.reason === "error"
                    ? "error"
                    : view.reason;
        if (model)
            infoParts.push(model);
        if (took)
            infoParts.push(took);
        if (reasonLabel)
            infoParts.push(reasonLabel);
    }
    return (_jsxs(Box, { flexDirection: "column", width: width, children: [hasThinking ? (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: theme.textMuted, italic: true, children: [expanded.thinking ? "▾ " : "▸ ", "thinking (", charsLabel(view.thinking.length), ")"] }), expanded.thinking ? (_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: view.thinking })) : null] })) : null, text !== "" ? (view.assembled ? (_jsx(Markdown, { md: text, theme: theme, width: width })) : (_jsx(Text, { color: theme.text, wrap: "wrap", children: text }))) : (_jsx(Text, { color: theme.textMuted, italic: true, children: view.finished && view.empty ? "*Finished without output*" : "…" })), infoParts.length > 0 ? (_jsx(Text, { color: theme.textMuted, children: ` (${infoParts.join(" · ")})` })) : null] }));
}
function ToolBody({ view, theme, width, expanded, spinFrame, }) {
    const tool = view.tool;
    const nameText = toolDisplayName(tool.name);
    const paramsWidth = Math.max(10, width - nameText.length - 6);
    const params = toolParamSummary(tool.name, tool.arguments, paramsWidth);
    const statusMark = tool.status === "running" ? (_jsx(Text, { color: theme.primary, children: SPINNER_FRAMES[(spinFrame ?? 0) % SPINNER_FRAMES.length] })) : tool.status === "error" ? (_jsx(Text, { color: theme.error, children: "\u2716" })) : (_jsx(Text, { color: theme.success, children: "\u2713" }));
    const head = (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: theme.textMuted, children: expanded.tool ? "▾ " : "▸ " }), _jsxs(Text, { color: theme.textMuted, children: [nameText, ": "] }), tool.status === "running" ? (_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: toolAction(tool.name) })) : (_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: params || " " })), _jsx(Text, { children: " " }), statusMark] }));
    return (_jsxs(Box, { flexDirection: "column", width: width, children: [head, expanded.tool && tool.status !== "running" ? (_jsx(Box, { marginTop: 0, children: renderToolResult(tool, theme, width) })) : null] }));
}
/** 渲染单条消息（完整）。 */
export const MessageBlock = React.memo(function MessageBlock({ view, theme, width, expanded, spinFrame, }) {
    const borderColor = view.kind === "user" ? theme.secondary : view.kind === "assistant" ? theme.primary : theme.border;
    return (_jsx(Box, { flexDirection: "column", width: width + MSG_BORDER + MSG_PADDING, borderLeft: true, borderTop: false, borderBottom: false, borderRight: false, borderStyle: "bold", borderColor: borderColor, paddingLeft: MSG_PADDING, paddingRight: MSG_PADDING, children: view.kind === "user" ? (_jsx(UserBody, { view: view, theme: theme, width: width })) : view.kind === "assistant" ? (_jsx(AssistantBody, { view: view, theme: theme, width: width, expanded: expanded })) : (_jsx(ToolBody, { view: view, theme: theme, width: width, expanded: expanded, spinFrame: spinFrame })) }));
});
// ── 高度估算（虚拟滚动用） ────────────────────────────────────────────────
import { estimateLines } from "../util.js";
/** 估算一条消息渲染后的行数（含 1 行安全余量；折叠感知）。 */
export function estimateMessageHeight(view, width, expanded) {
    const textWidth = Math.max(10, width);
    let lines = 0;
    if (view.kind === "user") {
        lines = estimateLines(view.content, textWidth);
    }
    else if (view.kind === "assistant") {
        if (view.thinking !== "") {
            lines += 1; // 折叠头
            if (expanded.thinking)
                lines += estimateLines(view.thinking, textWidth);
        }
        if (view.text !== "")
            lines += estimateLines(view.text, textWidth);
        else
            lines += 1;
        if (view.finished)
            lines += 1;
    }
    else {
        lines += 1; // 头部行
        const tool = view.tool;
        if (expanded.tool && tool.status !== "running") {
            const result = tool.result ?? "";
            if (tool.status === "error") {
                lines += 1;
            }
            else {
                const rl = Math.min(MAX_RESULT_HEIGHT, result.split("\n").length);
                lines += rl;
                if (result.split("\n").length > MAX_RESULT_HEIGHT)
                    lines += 1;
            }
        }
    }
    return lines + 1; // 安全余量
}
/** 折叠块稳定 id。 */
export function expandedId(kind, key) {
    return `${kind}:${key}`;
}
/** 消息是否含可折叠块（供鼠标命中判断）。 */
export function collapsibleKind(view) {
    if (view.kind === "assistant" && view.thinking !== "")
        return "thinking";
    if (view.kind === "tool")
        return "tool";
    return null;
}
//# sourceMappingURL=Message.js.map