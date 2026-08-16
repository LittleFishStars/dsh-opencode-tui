/** 渲染宽度（含 CJK 双宽）。 */
export declare function widthOf(text: string): number;
/** 截断字符串到渲染宽度，加省略号。 */
export declare function truncate(text: string, maxWidth: number, ellipsis?: string): string;
