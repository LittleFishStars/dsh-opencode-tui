import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 主应用：opencode 风格三区布局（消息 / 编辑器 / 可选右侧栏）+ 底部状态栏，
 * 全局键位路由 + 对话框编排 + spinner。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useSyncExternalStore } from "react";
import { getStore, getApprovalQueue, getQuestionQueue } from "../store.js";
import { THEMES, THEME_NAMES } from "../theme.js";
import { Messages } from "./Messages.js";
import { Editor } from "./Editor.js";
import { Sidebar } from "./Sidebar.js";
import { StatusBar } from "./StatusBar.js";
import { ConfirmDialog, HelpDialog, ListDialog, Dialog } from "./Dialog.js";
import { HELP_SECTIONS } from "../keys.js";
import { truncate } from "../util.js";
import { readdir } from "node:fs/promises";
/** 侧边栏宽度：opencode 右栏约 1/4 屏宽，封顶 36。 */
function sidebarWidth(totalWidth) {
    return Math.min(36, Math.max(26, Math.floor(totalWidth * 0.28)));
}
export function TuiApp({ actions, brand, commands, mouse }) {
    const store = getStore();
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const { stdout } = useStdout();
    const width = stdout.columns || 80;
    const height = (stdout.rows || 24) - 1; // 状态栏占一行
    const theme = THEMES[snapshot.themeName] ?? THEMES.opencode;
    const dialogOpen = Object.values(snapshot.dialogs).some(Boolean);
    const approvalActive = snapshot.approval !== null;
    const busy = snapshot.working.busy;
    // 提问队列（ask_user_question 工具）
    const questionQueue = getQuestionQueue();
    const question = questionQueue
        ? useSyncExternalStore(questionQueue.subscribe, questionQueue.getSnapshot)
        : null;
    const questionActive = question !== null;
    // spinner
    useEffect(() => {
        if (!busy)
            return;
        const timer = setInterval(() => store.tickSpinner(), 90);
        return () => clearInterval(timer);
    }, [busy, store]);
    // 会话对话框数据
    const sessionItems = useMemo(() => snapshot.sessions.map((s) => ({
        id: s.id,
        title: s.title || "New Session",
        subtitle: s.updatedAt ? new Date(s.updatedAt).toLocaleString() : undefined,
        icon: s.id === snapshot.currentSessionId ? "●" : "○",
    })), [snapshot.sessions, snapshot.currentSessionId]);
    const themeItems = useMemo(() => THEME_NAMES.map((name) => ({ id: name, title: name, icon: name === snapshot.themeName ? "●" : "○" })), [snapshot.themeName]);
    const modelItems = useMemo(() => {
        const m = snapshot.model;
        return m
            ? [{ id: `${m.provider}/${m.model}`, title: `${m.provider}/${m.model}`, subtitle: "read from agentDefaultModel" }]
            : [];
    }, [snapshot.model]);
    // 文件选择器状态
    const [filePicker, setFilePicker] = useState(null);
    const filePickerPendingRef = useRef(null);
    const openFilePicker = (prefix, done) => {
        filePickerPendingRef.current = done;
        store.openDialog("filepicker");
        setFilePicker({ dir: process.cwd(), selected: 0, files: [], dirs: [] });
        refreshFileList(process.cwd(), prefix, setFilePicker);
    };
    // 全局键位
    useInput((input, key) => {
        // ESC：对话框打开时先关对话框（HelpDialog 等被动对话框需要），否则取消生成
        if (key.escape) {
            if (dialogOpen) {
                store.closeAllDialogs();
                return;
            }
            if (busy) {
                actions.cancel();
            }
            return;
        }
        if (dialogOpen || approvalActive || questionActive)
            return; // 其余键交给对话框/审批自己处理
        // 会话列表快捷键
        if (key.ctrl && input === "c") {
            store.openDialog("quit");
            return;
        }
        if (key.ctrl && input === "h") {
            store.toggleDialog("help");
            return;
        }
        if (key.ctrl && input === "s") {
            store.openDialog("sessions");
            return;
        }
        if (key.ctrl && input === "k") {
            store.openDialog("commands");
            return;
        }
        if (key.ctrl && input === "o") {
            store.openDialog("models");
            return;
        }
        if (key.ctrl && input === "t") {
            store.openDialog("theme");
            return;
        }
        if (key.ctrl && input === "f") {
            openFilePicker("", (path) => {
                editorRef.current?.(` ${path}`);
            });
            return;
        }
        if (key.ctrl && input === "n") {
            actions.newSession();
            return;
        }
    });
    // 编辑器外部 setValue 注册（文件选择器插入用）
    const editorRef = useRef(null);
    const editorEmptyRef = useRef(true);
    // ── 鼠标分发：后注册者优先（对话框盖在消息区之上） ─────────────────────
    const mouseHandlersRef = useRef([]);
    const registerMouse = useMemo(() => (handler) => {
        mouseHandlersRef.current.push(handler);
        return () => {
            mouseHandlersRef.current = mouseHandlersRef.current.filter((h) => h !== handler);
        };
    }, []);
    useEffect(() => {
        return mouse.on((e) => {
            const handlers = mouseHandlersRef.current;
            for (let i = handlers.length - 1; i >= 0; i--) {
                if (handlers[i]?.(e))
                    return;
            }
        });
    }, [mouse]);
    // 会话切换：切走时退出跟随滚动（由 Messages 内部处理）
    const sbWidth = sidebarWidth(width);
    const mainWidth = snapshot.showSidebar ? Math.max(40, width - sbWidth) : width;
    const editorHeight = 3;
    return (_jsxs(Box, { flexDirection: "column", width: width, height: height + 1, backgroundColor: theme.background, children: [_jsxs(Box, { flexDirection: "row", width: width, flexGrow: 1, children: [_jsxs(Box, { flexDirection: "column", width: mainWidth, flexGrow: 1, backgroundColor: theme.background, children: [_jsx(Messages, { messages: snapshot.messages, width: mainWidth, height: Math.max(5, height - editorHeight), theme: theme, busy: busy, task: snapshot.working.task, spinFrame: snapshot.working.spinFrame, expanded: snapshot.expanded, showInitial: snapshot.currentSessionId === null && !snapshot.loadingSession, loading: snapshot.loadingSession, brand: brand, onRegisterMouse: registerMouse }), _jsx(Box, { borderTop: true, borderBottom: false, borderLeft: false, borderRight: false, borderColor: theme.border, flexDirection: "column", height: editorHeight, backgroundColor: theme.background, children: _jsx(Editor, { theme: theme, width: mainWidth, canSend: !busy, disabled: dialogOpen || approvalActive, onSubmit: (text) => actions.send(text), onExternalEditor: (current, done) => actions.openExternalEditor(current, done), onAtComplete: () => {
                                        openFilePicker("", (path) => editorRef.current?.(` ${path}`));
                                    }, onRegisterEditor: (set) => {
                                        editorRef.current = set;
                                    }, onValueChange: (value) => {
                                        editorEmptyRef.current = value === "";
                                    }, onHelpRequest: () => store.toggleDialog("help"), onSendBlocked: () => store.notify("warn", "Agent is working, please wait...") }) })] }), snapshot.showSidebar ? (_jsx(Box, { width: sbWidth, borderLeft: true, borderTop: false, borderBottom: false, borderRight: false, borderColor: theme.borderDim, backgroundColor: theme.sidebarBg, children: _jsx(Sidebar, { theme: theme, width: sbWidth - 1, height: Math.max(5, height - editorHeight), session: snapshot.sessions.find((s) => s.id === snapshot.currentSessionId) ?? null, model: snapshot.model, cwd: snapshot.cwd }) })) : null] }), _jsx(StatusBar, { theme: theme, width: width, notification: snapshot.notification, model: snapshot.model, sessionLabel: snapshot.currentTitle || null, busy: busy }), snapshot.dialogs.quit ? (_jsx(ConfirmDialog, { theme: theme, width: width, height: height, title: "Quit", message: "Are you sure you want to quit?", onConfirm: () => actions.quit(), onCancel: () => store.closeDialog("quit") })) : null, snapshot.dialogs.help ? (_jsx(HelpDialog, { theme: theme, width: width, height: height, sections: HELP_SECTIONS })) : null, snapshot.dialogs.sessions ? (_jsx(ListDialog, { theme: theme, width: width, height: height, title: "Sessions", items: sessionItems, emptyText: snapshot.sessionsLoaded ? "No sessions" : "Loading...", onConfirm: (item) => {
                    store.closeDialog("sessions");
                    actions.switchSession(item.id);
                }, onClose: () => store.closeDialog("sessions"), onRegisterMouse: registerMouse })) : null, snapshot.dialogs.commands ? (_jsx(ListDialog, { theme: theme, width: width, height: height, title: "Commands", items: commands, filterable: true, onConfirm: (item) => {
                    store.closeDialog("commands");
                    actions.runCommand(item.id);
                }, onClose: () => store.closeDialog("commands"), onRegisterMouse: registerMouse })) : null, snapshot.dialogs.models ? (_jsx(ListDialog, { theme: theme, width: width, height: height, title: "Models", items: modelItems, emptyText: "No model selection", onConfirm: () => store.closeDialog("models"), onClose: () => store.closeDialog("models"), onRegisterMouse: registerMouse })) : null, snapshot.dialogs.theme ? (_jsx(ListDialog, { theme: theme, width: width, height: height, title: "Theme", items: themeItems, filterable: false, onConfirm: (item) => {
                    store.closeDialog("theme");
                    actions.setTheme(item.id);
                }, onClose: () => store.closeDialog("theme"), onRegisterMouse: registerMouse })) : null, snapshot.dialogs.filepicker && filePicker ? (_jsx(FilePickerDialog, { theme: theme, width: width, height: height, state: filePicker, onChange: setFilePicker, onPick: (path) => {
                    const done = filePickerPendingRef.current;
                    filePickerPendingRef.current = null;
                    store.closeDialog("filepicker");
                    done?.(path);
                }, onClose: () => {
                    filePickerPendingRef.current = null;
                    store.closeDialog("filepicker");
                } })) : null, approvalActive && snapshot.approval ? (_jsx(ConfirmDialog, { theme: theme, width: width, height: height, title: `Permission needed: ${snapshot.approval.toolName}`, message: snapshot.approval.reason ?? snapshot.approval.command ?? "Allow this action?", confirmLabel: "Allow once", cancelLabel: "Reject", onConfirm: () => {
                    getApprovalQueue()?.decide("allowed-once");
                }, onCancel: () => {
                    getApprovalQueue()?.decide("rejected");
                } })) : null, questionActive && question ? _jsx(QuestionDialog, { theme: theme, width: width, height: height, question: question }) : null] }));
}
/** 提问对话框：渲染 ask_user_question 的选项菜单。 */
function QuestionDialog({ theme, width, height, question, }) {
    const [selected, setSelected] = useState(0);
    const [multiSelected, setMultiSelected] = useState(new Set());
    const item = question.questions[0];
    const options = item.options ?? [];
    const multi = item.multiSelect === true;
    useInput((input, key) => {
        if (key.escape) {
            getQuestionQueue()?.answer({ answers: [{ id: item.id, selected: [], custom: "cancelled" }] });
            return;
        }
        if (key.upArrow || (key.ctrl === false && input === "k")) {
            setSelected((prev) => Math.max(0, prev - 1));
            return;
        }
        if (key.downArrow || (key.ctrl === false && input === "j")) {
            setSelected((prev) => Math.min(options.length - 1, prev + 1));
            return;
        }
        if (key.return) {
            if (multi) {
                const next = new Set(multiSelected);
                next.add(selected);
                setMultiSelected(next);
                getQuestionQueue()?.answer({
                    answers: [{ id: item.id, selected: [...next].map((i) => options[i].label) }],
                });
                return;
            }
            const option = options[selected];
            getQuestionQueue()?.answer({
                answers: [{ id: item.id, selected: option ? [option.label] : [], custom: option ? undefined : input }],
            });
            return;
        }
        if (key.tab && multi) {
            setSelected((prev) => (prev + 1) % Math.max(1, options.length));
        }
    });
    return (_jsxs(Dialog, { theme: theme, width: width, height: height, title: item.header ?? "Question", children: [_jsx(Text, { color: theme.text, bold: true, wrap: "wrap", children: item.question }), item.detail ? (_jsx(Text, { color: theme.textMuted, wrap: "wrap", children: item.detail })) : null, _jsx(Box, { height: 1 }), _jsx(Box, { flexDirection: "column", children: options.length === 0 ? (_jsx(Text, { color: theme.textMuted, children: "Type an answer and press enter" })) : (options.map((option, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: i === selected ? theme.primary : theme.textMuted, children: i === selected ? (multi ? "☑ " : "› ") : multi ? "☐ " : "  " }), _jsx(Text, { color: i === selected ? theme.text : theme.textMuted, bold: i === selected, children: option.label })] }, i)))) }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.textMuted, dimColor: true, children: multi ? "enter to select & submit · tab next · esc cancel" : "↑/↓ or k/j navigate · enter submit · esc cancel" })] }));
}
/** 简单的文件选择器（目录导航 + 选择插入路径）。 */
function FilePickerDialog({ theme, width, height, state, onChange, onPick, onClose, }) {
    const items = [...state.dirs.map((d) => ({ name: d, dir: true })), ...state.files.map((f) => ({ name: f, dir: false }))];
    useInput((input, key) => {
        if (key.escape) {
            onClose();
            return;
        }
        if (key.upArrow || (key.ctrl === false && input === "k")) {
            onChange({ ...state, selected: Math.max(0, state.selected - 1) });
            return;
        }
        if (key.downArrow || (key.ctrl === false && input === "j")) {
            onChange({ ...state, selected: Math.min(items.length - 1, state.selected + 1) });
            return;
        }
        if (key.return) {
            const item = items[state.selected];
            if (!item)
                return;
            if (item.dir) {
                const dir = `${state.dir}/${item.name}`;
                onChange({ dir, selected: 0, files: [], dirs: [] });
                refreshFileList(dir, "", onChange);
            }
            else {
                onPick(`${state.dir}/${item.name}`);
            }
        }
        if (key.backspace) {
            // 回到父目录
            const parent = state.dir.split("/").slice(0, -1).join("/") || "/";
            onChange({ dir: parent, selected: 0, files: [], dirs: [] });
            refreshFileList(parent, "", onChange);
        }
    });
    const visible = items.slice(0, Math.max(1, height - 10));
    return (_jsxs(Dialog, { theme: theme, width: width, height: height, title: `Files: ${truncate(state.dir, 40)}`, children: [_jsx(Box, { flexDirection: "column", children: visible.length === 0 ? (_jsx(Text, { color: theme.textMuted, children: "empty directory" })) : (visible.map((item, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: i === state.selected ? theme.primary : theme.textMuted, children: i === state.selected ? "› " : "  " }), _jsxs(Text, { color: item.dir ? theme.secondary : i === state.selected ? theme.text : theme.textMuted, bold: item.dir, children: [item.dir ? "📁 " : "📄 ", item.name] })] }, i)))) }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.textMuted, dimColor: true, children: "enter pick \u00B7 backspace up \u00B7 esc close" })] }));
}
async function refreshFileList(dir, prefix, set) {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        const dirs = [];
        const files = [];
        for (const e of entries) {
            const name = e.name;
            if (prefix && !name.startsWith(prefix))
                continue;
            if (name.startsWith(".") && prefix === "")
                continue;
            if (e.isDirectory())
                dirs.push(name);
            else if (e.isFile())
                files.push(name);
        }
        dirs.sort();
        files.sort();
        set({ dir, selected: 0, files, dirs });
    }
    catch {
        set({ dir, selected: 0, files: [], dirs: [] });
    }
}
//# sourceMappingURL=App.js.map