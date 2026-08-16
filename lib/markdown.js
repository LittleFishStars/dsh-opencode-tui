import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Markdown 渲染：marked token 树 → Ink 元素。
 * 支持标题/段落/粗斜体/行内与围栏代码(highlight.js 高亮)/引用/列表/表格/分隔线/链接。
 */
import React from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import hljs from "highlight.js/lib/common";
marked.setOptions({
    gfm: true,
    breaks: false,
});
function hljsColor(cls, theme) {
    switch (cls) {
        case "hljs-comment":
        case "hljs-quote":
            return theme.synComment;
        case "hljs-keyword":
        case "hljs-selector-tag":
        case "hljs-literal":
        case "hljs-doctag":
        case "hljs-meta":
            return theme.synKeyword;
        case "hljs-title":
        case "hljs-title-function":
        case "hljs-section":
        case "hljs-function":
        case "hljs-name":
            return theme.synFunction;
        case "hljs-variable":
        case "hljs-template-variable":
        case "hljs-attr":
        case "hljs-attribute":
            return theme.synVariable;
        case "hljs-string":
        case "hljs-regexp":
        case "hljs-addition":
        case "hljs-char":
        case "hljs-symbol":
            return theme.synString;
        case "hljs-number":
        case "hljs-bullet":
        case "hljs-link":
            return theme.synNumber;
        case "hljs-type":
        case "hljs-built_in":
        case "hljs-selector-attr":
        case "hljs-selector-pseudo":
        case "hljs-class":
        case "hljs-title-class":
            return theme.synType;
        case "hljs-operator":
        case "hljs-params":
            return theme.synOperator;
        default:
            return undefined;
    }
}
/** 高亮代码 → 带颜色的行片段。 */
function highlightCode(code, lang, theme) {
    let html;
    try {
        if (lang && hljs.getLanguage(lang)) {
            html = hljs.highlight(code, { language: lang }).value;
        }
        else {
            html = hljs.highlightAuto(code, ["bash", "javascript", "typescript", "json", "python", "yaml", "markdown", "html", "css", "go", "rust", "sql", "diff", "java", "c", "cpp"]).value;
        }
    }
    catch {
        html = escapeHtml(code);
    }
    // 解析 hljs 输出：<span class="hljs-x">…</span>（无嵌套，纯文本）
    const segments = [];
    const regex = /<span class="([^"]+)">([\s\S]*?)<\/span>|([^<]+)/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        if (match[1] !== undefined) {
            const classes = match[1].split(/\s+/);
            let color;
            for (const cls of classes) {
                const c = hljsColor(cls, theme);
                if (c) {
                    color = c;
                    break;
                }
            }
            segments.push({ text: match[2], color });
        }
        else if (match[3] !== undefined) {
            segments.push({ text: match[3] });
        }
    }
    return segments;
}
function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** 递归展开行内 token → 样式片段。 */
function inlineSegments(tokens, theme) {
    const out = [];
    for (const token of tokens) {
        if (token.type === "text") {
            out.push({ text: token.text });
        }
        else if (token.type === "strong") {
            for (const seg of inlineSegments(token.tokens ?? [], theme))
                out.push({ ...seg, bold: true });
        }
        else if (token.type === "em") {
            for (const seg of inlineSegments(token.tokens ?? [], theme))
                out.push({ ...seg, italic: true });
        }
        else if (token.type === "del") {
            for (const seg of inlineSegments(token.tokens ?? [], theme))
                out.push({ ...seg, strike: true });
        }
        else if (token.type === "codespan") {
            out.push({ text: token.text, color: theme.mdCode });
        }
        else if (token.type === "link") {
            for (const seg of inlineSegments(token.tokens ?? [], theme)) {
                out.push({ ...seg, color: theme.mdLinkText, underline: true });
            }
        }
        else if (token.type === "image") {
            out.push({ text: `[${token.text}]`, color: theme.mdLinkText });
        }
        else if (token.type === "br") {
            out.push({ text: "\n" });
        }
        else if (token.type === "escape") {
            out.push({ text: token.text });
        }
        else if (token.type === "html") {
            out.push({ text: token.text });
        }
        else if (token.type === "space") {
            out.push({ text: " " });
        }
        else if ("text" in token && typeof token.text === "string") {
            out.push({ text: token.text });
        }
    }
    return out;
}
/** 行内片段 → 单个 Text 元素（多行文本时按行拆分渲染）。 */
export function InlineText({ segs, color, wrap }) {
    const nodes = [];
    let line = [];
    let key = 0;
    const flush = () => {
        if (line.length > 0) {
            nodes.push(_jsx(Text, { color: color, children: line }, key++));
            line = [];
        }
    };
    for (const seg of segs) {
        const parts = seg.text.split("\n");
        parts.forEach((part, i) => {
            if (i > 0) {
                flush();
                line = [];
            }
            line.push(_jsx(Text, { color: seg.color ?? color, bold: seg.bold, italic: seg.italic, underline: seg.underline, strikethrough: seg.strike, children: part }, `${key}-${i}`));
        });
    }
    flush();
    if (wrap === false) {
        return _jsx(Text, { color: color, children: nodes });
    }
    return (_jsx(Text, { color: color, wrap: "wrap", children: nodes }));
}
/** 代码块组件（带语法高亮）。 */
export function CodeBlock({ code, lang, theme }) {
    const segments = highlightCode(code, lang, theme);
    const lines = splitByNewline(segments);
    return (_jsx(Box, { flexDirection: "column", borderStyle: "single", borderColor: theme.borderDim, paddingLeft: 1, paddingRight: 1, marginTop: 0, children: lines.map((lineSegs, i) => (_jsx(Text, { children: lineSegs.length === 0
                ? " "
                : lineSegs.map((seg, j) => (_jsx(Text, { color: seg.color, children: seg.text }, j))) }, i))) }));
}
function splitByNewline(segments) {
    const lines = [[]];
    for (const seg of segments) {
        const parts = seg.text.split("\n");
        parts.forEach((part, i) => {
            if (i > 0)
                lines.push([]);
            if (part !== "")
                lines[lines.length - 1].push({ text: part, color: seg.color });
        });
    }
    return lines;
}
/** 一个 markdown 文档 → Ink 块元素列表（不包含包裹 Box）。 */
export function renderMarkdownBlocks(md, theme) {
    const tokens = marked.lexer(md, { gfm: true });
    const blocks = [];
    let key = 0;
    const inline = (toks) => {
        const segs = inlineSegments(toks, theme);
        return _jsx(InlineText, { segs: segs }, key++);
    };
    for (const token of tokens) {
        switch (token.type) {
            case "heading": {
                const level = token.depth;
                const segs = inlineSegments(token.tokens ?? [], theme);
                const marker = level === 1 ? "█ " : level === 2 ? "▊ " : level === 3 ? "▎ " : "";
                blocks.push(_jsxs(Text, { bold: level <= 2, color: theme.mdHeading, children: [marker, _jsx(InlineText, { segs: segs, color: theme.mdHeading })] }, key++));
                break;
            }
            case "paragraph":
                blocks.push(_jsx(Text, { children: inline(token.tokens ?? []) }, key++));
                break;
            case "code":
                blocks.push(_jsx(CodeBlock, { code: token.text, lang: token.lang ?? undefined, theme: theme }, key++));
                break;
            case "blockquote": {
                const inner = renderMarkdownBlocks(token.text, theme);
                blocks.push(_jsx(Box, { flexDirection: "column", borderLeft: true, borderColor: theme.mdBlockQuote, paddingLeft: 1, marginLeft: 0, children: inner.map((b, i) => (_jsx(React.Fragment, { children: b }, i))) }, key++));
                break;
            }
            case "list": {
                const ordered = token.ordered;
                let index = token.start ?? 1;
                blocks.push(_jsx(Box, { flexDirection: "column", children: token.items.map((item, i) => {
                        const marker = ordered ? `${index++}.` : "•";
                        const itemBody = item.tokens ? inline(item.tokens) : _jsx(Text, { children: item.text });
                        return (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: theme.mdListItem, children: [marker, " "] }), _jsxs(Box, { flexDirection: "column", flexShrink: 1, children: [itemBody, item.tokens?.some((t) => t.type === "list") ? (_jsx(Box, { marginLeft: 2, children: renderMarkdownBlocks(item.tokens
                                                .filter((t) => t.type === "list")
                                                .map((t) => t.raw)
                                                .join("\n"), theme).map((b, j) => (_jsx(React.Fragment, { children: b }, j))) })) : null] })] }, i));
                    }) }, key++));
                break;
            }
            case "hr":
                blocks.push(_jsx(Text, { color: theme.mdHr, children: "─".repeat(40) }, key++));
                break;
            case "table": {
                const header = token.header;
                const rows = token.rows;
                blocks.push(_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, color: theme.mdHeading, children: header.join(" | ") }), rows.map((row, i) => (_jsx(Text, { children: row.join(" | ") }, i)))] }, key++));
                break;
            }
            case "space":
                break;
            default:
                if ("text" in token && typeof token.text === "string" && token.text.trim() !== "") {
                    blocks.push(_jsx(Text, { children: token.text }, key++));
                }
        }
    }
    return blocks;
}
/** 把 markdown 渲染为一列块（消息正文用）。 */
export function Markdown({ md, theme, width }) {
    if (md.trim() === "") {
        return _jsx(Text, { children: " " });
    }
    const blocks = renderMarkdownBlocks(md, theme);
    return (_jsx(Box, { flexDirection: "column", width: width, flexShrink: 1, children: blocks.map((block, i) => (_jsx(React.Fragment, { children: block }, i))) }));
}
//# sourceMappingURL=markdown.js.map