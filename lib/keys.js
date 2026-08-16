export const GLOBAL_KEYS = [
    { keys: ["ctrl+c"], help: "ctrl+c", description: "quit" },
    { keys: ["?"], help: "?", description: "toggle help (empty input)" },
    { keys: ["ctrl+s"], help: "ctrl+s", description: "switch session" },
    { keys: ["ctrl+k"], help: "ctrl+k", description: "commands" },
    { keys: ["ctrl+o"], help: "ctrl+o", description: "model selection" },
    { keys: ["ctrl+t"], help: "ctrl+t", description: "switch theme" },
    { keys: ["ctrl+f"], help: "ctrl+f", description: "select files" },
];
export const CHAT_KEYS = [
    { keys: ["ctrl+n"], help: "ctrl+n", description: "new session" },
    { keys: ["esc"], help: "esc", description: "cancel generation" },
    { keys: ["@"], help: "@", description: "complete file path" },
    { keys: ["enter"], help: "enter", description: "send message" },
    { keys: ["\\ + enter"], help: "\\ + enter", description: "add a new line" },
];
export const MESSAGE_KEYS = [
    { keys: ["f", "pgdn"], help: "f/pgdn", description: "page down" },
    { keys: ["b", "pgup"], help: "b/pgup", description: "page up" },
    { keys: ["ctrl+u"], help: "ctrl+u", description: "½ page up" },
    { keys: ["ctrl+d"], help: "ctrl+d", description: "½ page down" },
];
export const EDITOR_KEYS = [
    { keys: ["ctrl+e"], help: "ctrl+e", description: "open external editor" },
    { keys: ["ctrl+a"], help: "ctrl+a", description: "line start" },
    { keys: ["ctrl+e"], help: "ctrl+e", description: "line end" },
    { keys: ["ctrl+u"], help: "ctrl+u", description: "clear line" },
];
export const HELP_SECTIONS = [
    { title: "Global", bindings: GLOBAL_KEYS },
    { title: "Chat", bindings: CHAT_KEYS },
    { title: "Messages", bindings: MESSAGE_KEYS },
];
//# sourceMappingURL=keys.js.map