/**
 * 品牌字形。
 *
 * WHALE_GLYPH：DeepSeek 官方鱼 logo 的半块渲染（figma I39:24057;88:8943
 * fillGeometry 精确提取，26 列 × 8 半块行；空白格是固定网格的一部分，
 * 渲染时保留不要裁剪）。来自 @deepseek-ai/dsh-code 的 whale-glyph.ts。
 *
 * `logo` / `go`：旧版 ASCII wordmark（保留给退出画面等小尺寸场景）。
 */
export const WHALE_GLYPH: readonly string[] = [
  "    ▄▄▄▄▄▄▄▄█    ▄█▄     ▄",
  " ▄▄██████████▄▄  ▀███▄████",
  "▄███████████████▄  ███▀▀▀ ",
  "██     ▀▀█████▄▀██████    ",
  "██▄       ▀████▄▄████     ",
  " ██▄        ▀██████▀      ",
  "  ▀██▄▄  ██▄  ▀███▄▄      ",
  "     ▀▀███████▀▀ ▀▀▀      ",
]

/** 字形宽度（终端列）。 */
export const WHALE_GLYPH_COLUMNS = 26

export const logo = {
  left: ["         ", "█▀▀▄ █▀▀█", "█__█ █___", "▀▀▀▀ ▀▀▀▄"],
  right: ["    ", "█__█", "█▀▀█", "█__█"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
