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
    primary: string;
    secondary: string;
    accent: string;
    error: string;
    warning: string;
    success: string;
    info: string;
    border: string;
    borderFocused: string;
    borderDim: string;
    mdHeading: string;
    mdLink: string;
    mdLinkText: string;
    mdCode: string;
    mdBlockQuote: string;
    mdEmph: string;
    mdStrong: string;
    mdHr: string;
    mdListItem: string;
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
export declare const opencodeTheme: Theme;
/** 亮色变体（opencode Light）。 */
export declare const opencodeLightTheme: Theme;
/** 另一个可选主题：Dracula 风（仿 opencode 的 dracula 主题）。 */
export declare const draculaTheme: Theme;
export declare const THEMES: Record<string, Theme>;
export declare const THEME_NAMES: string[];
export declare function loadThemeName(dir: string): string;
export declare function saveThemeName(dir: string, name: string): void;
