export const opencodeTheme = {
    name: "opencode",
    dark: true,
    background: "#0d0d0d",
    sidebarBg: "#2a2a2a",
    dialogBg: "#1c1c1c",
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
export const opencodeLightTheme = {
    ...opencodeTheme,
    name: "opencode-light",
    dark: false,
    background: "#f8f8f8",
    sidebarBg: "#ececec",
    dialogBg: "#f2f2f2",
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
export const draculaTheme = {
    ...opencodeTheme,
    name: "dracula",
    background: "#1e1f29",
    sidebarBg: "#282a36",
    dialogBg: "#21222c",
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
export const THEMES = {
    opencode: opencodeTheme,
    "opencode-light": opencodeLightTheme,
    dracula: draculaTheme,
};
export const THEME_NAMES = Object.keys(THEMES);
/** 持久化当前主题名。 */
const THEME_FILE = "theme.json";
export function loadThemeName(dir) {
    try {
        const fs = require("node:fs");
        const path = require("node:path");
        const raw = fs.readFileSync(path.join(dir, THEME_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.theme && parsed.theme in THEMES)
            return parsed.theme;
    }
    catch {
        /* 无持久化文件 → 默认 */
    }
    return "opencode";
}
export function saveThemeName(dir, name) {
    try {
        const fs = require("node:fs");
        const path = require("node:path");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, THEME_FILE), JSON.stringify({ theme: name }, null, 2));
    }
    catch {
        /* 持久化失败不影响运行 */
    }
}
//# sourceMappingURL=theme.js.map