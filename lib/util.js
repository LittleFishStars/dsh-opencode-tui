/**
 * 通用工具：宽度与截断（桥插件用）。
 */
import stringWidth from "string-width";
/** 渲染宽度（含 CJK 双宽）。 */
export function widthOf(text) {
    return stringWidth(text);
}
/** 截断字符串到渲染宽度，加省略号。 */
export function truncate(text, maxWidth, ellipsis = "...") {
    if (widthOf(text) <= maxWidth)
        return text;
    let out = "";
    let w = 0;
    const budget = Math.max(0, maxWidth - widthOf(ellipsis));
    for (const ch of text) {
        const cw = stringWidth(ch);
        if (w + cw > budget)
            break;
        out += ch;
        w += cw;
    }
    return out + ellipsis;
}
//# sourceMappingURL=util.js.map