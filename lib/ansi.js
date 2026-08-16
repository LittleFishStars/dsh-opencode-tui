import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ANSI 文本渲染组件：把任意含 ANSI 转义的内容渲染成 Ink 元素。
 * 用于工具输出（bash 彩色输出等）。
 */
import React from "react";
import { Text } from "ink";
import { parseAnsi } from "./util.js";
/** ANSI 颜色 → Ink 颜色名。 */
const INK_COLORS = {
    black: "black",
    red: "red",
    green: "green",
    yellow: "yellow",
    blue: "blue",
    magenta: "magenta",
    cyan: "cyan",
    white: "white",
    brightBlack: "blackBright",
    brightRed: "redBright",
    brightGreen: "greenBright",
    brightYellow: "yellowBright",
    brightBlue: "blueBright",
    brightMagenta: "magentaBright",
    brightCyan: "cyanBright",
    brightWhite: "whiteBright",
    default: "",
};
/**
 * 把含 ANSI 的文本渲染为带样式的行内内容。
 * 注意：本组件不换行 —— 外层负责按宽度换行（Ink Text 自动换行）。
 */
export function AnsiInline({ text, color, backgroundColor, bold, dim }) {
    if (!text.includes("\x1b")) {
        return (_jsx(Text, { color: color, backgroundColor: backgroundColor, bold: bold, dimColor: dim, children: text }));
    }
    const segments = parseAnsi(text);
    if (segments.length === 0)
        return _jsx(Text, {});
    return (_jsx(Text, { color: color, backgroundColor: backgroundColor, bold: bold, dimColor: dim, children: segments.map((seg, i) => (_jsx(Text, { color: seg.fg && seg.fg !== "default" ? INK_COLORS[seg.fg] : color, backgroundColor: seg.bg && seg.bg !== "default" ? INK_COLORS[seg.bg] : backgroundColor, bold: seg.bold, dimColor: seg.dim, italic: seg.italic, underline: seg.underline, strikethrough: seg.strike, children: seg.text }, i))) }));
}
/**
 * 多行 ANSI 文本（含换行），逐行渲染，保持样式。
 */
export function AnsiBlock({ text, color, backgroundColor }) {
    const lines = text.split("\n");
    return (_jsx(Text, { color: color, backgroundColor: backgroundColor, children: lines.map((line, i) => (_jsxs(React.Fragment, { children: [_jsx(AnsiInline, { text: line, color: color, backgroundColor: backgroundColor }), i < lines.length - 1 ? "\n" : null] }, i))) }));
}
//# sourceMappingURL=ansi.js.map