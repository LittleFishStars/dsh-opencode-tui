/**
 * opencode 主题移植：配色与 opencode 的 OpenCodeTheme 保持一致
 * （暗色 #212121 底 + 橙/蓝/紫点缀）。
 */
export interface Theme {
  name: string;
  /** 是否暗色主题 */
  dark: boolean;
  background: string;
  backgroundSecondary: string;
  backgroundDarker: string;
  text: string;
  textMuted: string;
  textEmphasized: string;
  primary: string; // 橙 gold（opencode 品牌色）
  secondary: string; // 蓝
  accent: string; // 紫
  error: string;
  warning: string;
  success: string;
  info: string;
  border: string;
  borderFocused: string;
  borderDim: string;
  // markdown
  mdHeading: string;
  mdLink: string;
  mdLinkText: string;
  mdCode: string;
  mdBlockQuote: string;
  mdEmph: string;
  mdStrong: string;
  mdHr: string;
  mdListItem: string;
  // syntax（映射 highlight.js 语义 → 颜色）
  synComment: string;
  synKeyword: string;
  synFunction: string;
  synVariable: string;
  synString: string;
  synNumber: string;
  synType: string;
  synOperator: string;
  synPunctuation: string;
}

export const opencodeTheme: Theme = {
  name: "opencode",
  dark: true,
  background: "#212121",
  backgroundSecondary: "#252525",
  backgroundDarker: "#121212",
  text: "#e0e0e0",
  textMuted: "#6a6a6a",
  textEmphasized: "#e5c07b",
  primary: "#fab283",
  secondary: "#5c9cf5",
  accent: "#9d7cd8",
  error: "#e06c75",
  warning: "#f5a742",
  success: "#7fd88f",
  info: "#56b6c2",
  border: "#4b4c5c",
  borderFocused: "#fab283",
  borderDim: "#303030",
  mdHeading: "#5c9cf5",
  mdLink: "#fab283",
  mdLinkText: "#56b6c2",
  mdCode: "#7fd88f",
  mdBlockQuote: "#e5c07b",
  mdEmph: "#e5c07b",
  mdStrong: "#9d7cd8",
  mdHr: "#6a6a6a",
  mdListItem: "#fab283",
  synComment: "#6a6a6a",
  synKeyword: "#5c9cf5",
  synFunction: "#fab283",
  synVariable: "#e06c75",
  synString: "#7fd88f",
  synNumber: "#9d7cd8",
  synType: "#e5c07b",
  synOperator: "#56b6c2",
  synPunctuation: "#e0e0e0",
};

/** 亮色变体（opencode Light）。 */
export const opencodeLightTheme: Theme = {
  ...opencodeTheme,
  name: "opencode-light",
  dark: false,
  background: "#f8f8f8",
  backgroundSecondary: "#f0f0f0",
  backgroundDarker: "#ffffff",
  text: "#2a2a2a",
  textMuted: "#8a8a8a",
  textEmphasized: "#b0851f",
  primary: "#3b7dd8",
  secondary: "#7b5bb6",
  accent: "#d68c27",
  error: "#d1383d",
  warning: "#d68c27",
  success: "#3d9a57",
  info: "#318795",
  border: "#d3d3d3",
  borderFocused: "#3b7dd8",
  borderDim: "#e5e5e6",
  mdHeading: "#7b5bb6",
  mdLink: "#3b7dd8",
  mdLinkText: "#318795",
  mdCode: "#3d9a57",
  mdBlockQuote: "#b0851f",
  mdEmph: "#b0851f",
  mdStrong: "#d68c27",
  mdListItem: "#3b7dd8",
  synComment: "#8a8a8a",
  synKeyword: "#7b5bb6",
  synFunction: "#3b7dd8",
  synVariable: "#d1383d",
  synString: "#3d9a57",
  synNumber: "#d68c27",
  synType: "#b0851f",
  synOperator: "#318795",
  synPunctuation: "#2a2a2a",
};

/** 另一个可选主题：Dracula 风（仿 opencode 的 dracula 主题）。 */
export const draculaTheme: Theme = {
  ...opencodeTheme,
  name: "dracula",
  background: "#282a36",
  backgroundSecondary: "#2f3242",
  backgroundDarker: "#21222c",
  text: "#f8f8f2",
  textMuted: "#6272a4",
  textEmphasized: "#f1fa8c",
  primary: "#bd93f9",
  secondary: "#8be9fd",
  accent: "#ff79c6",
  error: "#ff5555",
  warning: "#ffb86c",
  success: "#50fa7b",
  info: "#8be9fd",
  border: "#44475a",
  borderFocused: "#bd93f9",
  borderDim: "#343746",
  mdHeading: "#8be9fd",
  mdLink: "#ff79c6",
  mdLinkText: "#8be9fd",
  mdCode: "#50fa7b",
  mdBlockQuote: "#f1fa8c",
  mdEmph: "#f1fa8c",
  mdStrong: "#ff79c6",
  mdListItem: "#bd93f9",
  synComment: "#6272a4",
  synKeyword: "#ff79c6",
  synFunction: "#50fa7b",
  synVariable: "#ff5555",
  synString: "#f1fa8c",
  synNumber: "#bd93f9",
  synType: "#8be9fd",
  synOperator: "#ff79c6",
  synPunctuation: "#f8f8f2",
};

export const THEMES: Record<string, Theme> = {
  opencode: opencodeTheme,
  "opencode-light": opencodeLightTheme,
  dracula: draculaTheme,
};

export const THEME_NAMES = Object.keys(THEMES);

/** 持久化当前主题名。 */
const THEME_FILE = "theme.json";

export function loadThemeName(dir: string): string {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const raw = fs.readFileSync(path.join(dir, THEME_FILE), "utf8");
    const parsed = JSON.parse(raw) as { theme?: string };
    if (parsed.theme && parsed.theme in THEMES) return parsed.theme;
  } catch {
    /* 无持久化文件 → 默认 */
  }
  return "opencode";
}

export function saveThemeName(dir: string, name: string): void {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, THEME_FILE), JSON.stringify({ theme: name }, null, 2));
  } catch {
    /* 持久化失败不影响运行 */
  }
}
