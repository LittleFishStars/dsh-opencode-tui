import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行。
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { MessageBlock, estimateMessageHeight } from "./Message.js";
import { truncate } from "../util.js";
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/** 消息稳定 id（供 React key / memo）。 */
export function messageKey(view) {
    if (view.kind === "user")
        return view.id;
    if (view.kind === "assistant")
        return view.id;
    return view.tool.id;
}
function workingTask(messages) {
    if (messages.length === 0)
        return null;
    const hasRunningTool = messages.some((m) => m.kind === "tool" && m.tool.status === "running");
    if (hasRunningTool)
        return "Waiting for tool response...";
    const last = messages[messages.length - 1];
    if (last?.kind === "assistant" && !last.assembled)
        return "Generating...";
    if (last?.kind === "assistant" && !last.finished)
        return "Building tool call...";
    return "Thinking...";
}
export function Messages({ messages, width, height, theme, busy, task, spinFrame, showInitial, brand, loading, }) {
    const [scrollTop, setScrollTop] = useState(0);
    const [follow, setFollow] = useState(true);
    const scrollTopRef = useRef(scrollTop);
    const followRef = useRef(follow);
    scrollTopRef.current = scrollTop;
    followRef.current = follow;
    const uiMessages = useMemo(() => {
        const textWidth = Math.max(10, width - 3);
        return messages.map((view) => ({
            view,
            height: estimateMessageHeight(view, textWidth),
        }));
    }, [messages, width]);
    const totalHeight = useMemo(() => {
        if (uiMessages.length === 0)
            return 0;
        return uiMessages.reduce((acc, m) => acc + m.height + 1, 0) - 1;
    }, [uiMessages]);
    const maxScroll = Math.max(0, totalHeight - height);
    // 新内容到来时跟随底部
    const lastSeq = messages.length > 0 ? messages[messages.length - 1].seq : 0;
    useEffect(() => {
        if (followRef.current) {
            setScrollTop(maxScroll);
        }
    }, [lastSeq, maxScroll, follow]);
    const clamp = (v) => Math.max(0, Math.min(maxScroll, v));
    useInput((_input, key) => {
        if (key.pageDown) {
            setFollow(false);
            setScrollTop((prev) => clamp(prev + Math.max(1, Math.floor(height / 2))));
        }
        else if (key.pageUp) {
            setFollow(false);
            setScrollTop((prev) => clamp(prev - Math.max(1, Math.floor(height / 2))));
        }
        else if (key.ctrl && key.upArrow) {
            setFollow(false);
            setScrollTop((prev) => clamp(prev - 1));
        }
        else if (key.ctrl && key.downArrow) {
            setFollow(false);
            setScrollTop((prev) => clamp(prev + 1));
        }
    });
    // 渲染窗口：覆盖 [scrollTop, scrollTop+height]，只包含能完整放下的消息
    const window = useMemo(() => {
        if (uiMessages.length === 0) {
            return { offset: 0, visible: [], pad: height };
        }
        let start = 0;
        let offset = 0;
        let acc = 0;
        for (let i = 0; i < uiMessages.length; i++) {
            const h = uiMessages[i].height + 1;
            if (acc + h > scrollTop) {
                start = i;
                offset = acc;
                break;
            }
            acc += h;
        }
        const visible = [];
        let used = offset;
        for (let i = start; i < uiMessages.length; i++) {
            const h = uiMessages[i].height + 1;
            if (used - offset + h > height)
                break;
            visible.push(uiMessages[i]);
            used += h;
        }
        return { offset, visible, pad: Math.max(0, height - (used - offset)) };
    }, [uiMessages, scrollTop, height]);
    // 底部工作行 + 帮助行（opencode 风格）
    const workingLine = (() => {
        if (!busy || messages.length === 0)
            return null;
        const taskText = task ?? workingTask(messages) ?? "Thinking...";
        const frame = SPINNER_FRAMES[spinFrame % SPINNER_FRAMES.length];
        return (_jsxs(Text, { color: theme.primary, bold: true, children: [frame, " ", taskText] }));
    })();
    const helpLine = (_jsxs(Text, { color: theme.textMuted, bold: true, children: ["press ", _jsx(Text, { color: theme.text, bold: true, children: "enter" }), " to send the message, write ", _jsx(Text, { color: theme.text, bold: true, children: "\\" }), " and enter to add a new line"] }));
    if (showInitial) {
        return (_jsxs(Box, { flexDirection: "column", width: width, height: height, paddingLeft: 1, paddingRight: 1, children: [_jsxs(Box, { flexGrow: 1, flexDirection: "column", justifyContent: "center", children: [_jsx(Text, { color: theme.primary, bold: true, children: brand }), _jsx(Text, { color: theme.textMuted, children: truncate(`dsh agent — opencode-style TUI. ctrl+? for help.`, width - 4) })] }), helpLine] }));
    }
    if (loading) {
        return (_jsxs(Box, { flexDirection: "column", width: width, height: height, paddingLeft: 1, paddingRight: 1, children: [_jsx(Text, { color: theme.textMuted, children: "Loading..." }), _jsx(Text, { color: theme.textMuted, children: "press esc to cancel" })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", width: width, height: height, paddingLeft: 1, paddingRight: 1, children: [_jsxs(Box, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: [window.offset > 0 ? _jsx(Box, { height: window.offset }) : null, window.visible.map((um) => (_jsx(Box, { flexDirection: "column", height: um.height, children: _jsx(MessageBlock, { view: um.view, theme: theme, width: Math.max(10, width - 3) }) }, messageKey(um.view)))), window.pad > 0 ? _jsx(Box, { flexGrow: 1, height: window.pad }) : null] }), _jsxs(Box, { flexDirection: "column", children: [workingLine, busy ? (_jsxs(Text, { color: theme.textMuted, bold: true, children: ["press ", _jsx(Text, { color: theme.text, bold: true, children: "esc" }), " to exit cancel"] })) : (helpLine)] })] }));
}
//# sourceMappingURL=Messages.js.map