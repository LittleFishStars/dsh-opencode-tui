/**
 * 品牌字形。
 *
 * `logo` 为 DSH wordmark：left（muted）+ right（加粗）两半拼成 "DSH"。
 * 记号字符见 `marks`（`_` 空格+阴影底、`^` 上块+阴影底、`~` 阴影上块、
 * `,` 阴影下块），由渲染方（Logo 组件 / presentation epilogue）解释。
 */
export const logo = {
  left: ["         ", "█▀▀▄ █▀▀█", "█__█ █^^^", "▀▀▀▄ ▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▄"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
