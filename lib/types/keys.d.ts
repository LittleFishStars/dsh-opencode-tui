/**
 * opencode 风格键位定义 + 帮助面板内容。
 */
export interface KeyBinding {
    keys: string[];
    help: string;
    description: string;
}
export declare const GLOBAL_KEYS: KeyBinding[];
export declare const CHAT_KEYS: KeyBinding[];
export declare const MESSAGE_KEYS: KeyBinding[];
export declare const EDITOR_KEYS: KeyBinding[];
export interface HelpSection {
    title: string;
    bindings: KeyBinding[];
}
export declare const HELP_SECTIONS: HelpSection[];
