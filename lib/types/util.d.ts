/** 渲染宽度（含 CJK 双宽）。 */
export declare function widthOf(text: string): number;
/**
 * 把一段文本按宽度折行（终端语义），返回每一行。
 * 用于估算消息渲染高度（与 Ink 的 Text 换行基本一致）。
 */
export declare function wrapLines(text: string, width: number): string[];
/** 估算一段文本渲染成 terminal 行所需的行数（按给定宽度）。 */
export declare function estimateLines(text: string, width: number): number;
/** 计算若干段文本（各自独立折行）的总行数。 */
export declare function totalLines(parts: string[], width: number): number;
/** 截断字符串到渲染宽度，加省略号。 */
export declare function truncate(text: string, maxWidth: number, ellipsis?: string): string;
/** ANSI 颜色语义 → 我们的 16 色映射（用于工具输出等任意 ANSI 文本）。 */
export type AnsiColor = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite" | "default";
export interface StyledSegment {
    text?: string;
    fg?: AnsiColor;
    bg?: AnsiColor;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
    strike?: boolean;
}
/**
 * 把任意 ANSI 文本解析成带样式的分段（供 Ink Text 渲染）。
 * 自实现 SGR 解析：\x1b[<params>m 序列；其余转义（OSC/链接等）剥离。
 */
export declare function parseAnsi(text: string): StyledSegment[];
/** 去掉 ANSI 后的纯文本。 */
export declare function stripAnsi(text: string): string;
/** 从富文本（可含 ANSI）提取纯文本。 */
export declare function plainText(text: string): string;
/** 时间差格式化（opencode 风格）：3ms / 4.2s / 1m30s。 */
export declare function formatDuration(startMs: number, endMs: number): string;
/** 相对时间（会话列表用）：刚刚 / 3m / 2h / 3d。 */
export declare function formatRelativeTime(ts: number): string;
/** 会话标题兜底。 */
export declare function fallbackTitle(text: string, maxWords?: number, maxBytes?: number): string;
/** 转圈帧序列。 */
export declare const SPINNER_FRAMES: string[];
