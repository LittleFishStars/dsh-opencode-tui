/**
 * Markdown 渲染：marked token 树 → Ink 元素。
 * 支持标题/段落/粗斜体/行内与围栏代码(highlight.js 高亮)/引用/列表/表格/分隔线/链接。
 */
import React from "react";
import type { Theme } from "./theme.js";
/** 行内样式片段。 */
interface InlineSeg {
    text: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
}
/** 行内片段 → 单个 Text 元素（多行文本时按行拆分渲染）。 */
export declare function InlineText({ segs, color, wrap }: {
    segs: InlineSeg[];
    color?: string;
    wrap?: boolean;
}): React.ReactElement;
/** 代码块组件（带语法高亮）。 */
export declare function CodeBlock({ code, lang, theme }: {
    code: string;
    lang?: string;
    theme: Theme;
}): React.ReactElement;
/** 一个 markdown 文档 → Ink 块元素列表（不包含包裹 Box）。 */
export declare function renderMarkdownBlocks(md: string, theme: Theme): React.ReactElement[];
/** 把 markdown 渲染为一列块（消息正文用）。 */
export declare function Markdown({ md, theme, width }: {
    md: string;
    theme: Theme;
    width?: number;
}): React.ReactElement;
export {};
