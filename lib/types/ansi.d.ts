/**
 * ANSI 文本渲染组件：把任意含 ANSI 转义的内容渲染成 Ink 元素。
 * 用于工具输出（bash 彩色输出等）。
 */
import React from "react";
export interface AnsiTextProps {
    text: string;
    /** 若为 true 且文本不含 ANSI，则整段作为普通文本渲染（性能路径） */
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    dim?: boolean;
}
/**
 * 把含 ANSI 的文本渲染为带样式的行内内容。
 * 注意：本组件不换行 —— 外层负责按宽度换行（Ink Text 自动换行）。
 */
export declare function AnsiInline({ text, color, backgroundColor, bold, dim }: AnsiTextProps): React.ReactElement;
/**
 * 多行 ANSI 文本（含换行），逐行渲染，保持样式。
 */
export declare function AnsiBlock({ text, color, backgroundColor }: AnsiTextProps): React.ReactElement;
