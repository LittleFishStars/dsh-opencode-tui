/**
 * 品牌字形。
 *
 * `logo` 为 DSH wordmark：left（muted "DS"）+ right（加粗 "H"）两半拼成 "DSH"。
 * 记号字符见 `marks`（`_` 空格+阴影底、`^` 上块+阴影底、`~` 阴影上块、
 * `,` 阴影下块），由渲染方（Logo 组件 / presentation epilogue）解释。
 *
 * D：顶右圆角 + 两侧竖 + 底平（避免底角实心块读成 Q）
 * S：上圈 + 左下竖 + 底横右下圆角（经典像素 S，中间无横，不与 e 混淆）
 * H：两侧竖 + 中横梁（无顶横/底横）
 */
export const logo = {
  left: ["         ", "█▀▀▄ █▀▀█", "█__█ █___", "▀▀▀▀ ▀▀▀▄"],
  right: ["    ", "█__█", "█▀▀█", "█__█"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
