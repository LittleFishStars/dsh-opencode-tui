import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行 + 鼠标支持。
 *
 * 滚动数学（行数）与渲染布局严格一致：每条消息高度 = 估算高度（含安全余量），
 * 无额外行距；顶部用 offset spacer 对齐窗口。
 */
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { MessageBlock, estimateMessageHeight, collapsibleKind, expandedId } from "./Message.js";
import { SPINNER_FRAMES, truncate } from "../util.js";
import { getStore } from "../store.js";
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
export function Messages({ messages, width, height, theme, busy, task, spinFrame, expanded, showInitial, brand, loading, onRegisterMouse, }) {
    const [scrollTop, setScrollTop] = useState(0);
    const [follow, setFollow] = useState(true);
    const scrollTopRef = useRef(scrollTop);
    const followRef = useRef(follow);
    scrollTopRef.current = scrollTop;
    followRef.current = follow;
    const textWidth = Math.max(10, width - 3);
    const uiMessages = useMemo(() => {
        return messages.map((view) => {
            const key = messageKey(view);
            const exp = {
                thinking: view.kind === "assistant" && view.thinking !== "" && expanded[expandedId("thinking", key)] === true,
                tool: view.kind === "tool" && expanded[expandedId("tool", key)] === true,
            };
            return { view, height: estimateMessageHeight(view, textWidth, exp) };
        });
    }, [messages, textWidth, expanded]);
    const totalHeight = useMemo(() => {
        if (uiMessages.length === 0)
            return 0;
        return uiMessages.reduce((acc, m) => acc + m.height, 0);
    }, [uiMessages]);
    const maxScroll = Math.max(0, totalHeight - height);
    const maxScrollRef = useRef(maxScroll);
    maxScrollRef.current = maxScroll;
    const clamp = useCallback((v) => Math.max(0, Math.min(maxScrollRef.current, v)), []);
    // 新内容到来时跟随底部
    const lastSeq = messages.length > 0 ? messages[messages.length - 1].seq : 0;
    useEffect(() => {
        if (followRef.current) {
            setScrollTop(maxScrollRef.current);
        }
        // 滚动位置超出新上限时收拢
        else if (scrollTopRef.current > maxScrollRef.current) {
            setScrollTop(maxScrollRef.current);
        }
    }, [lastSeq, maxScroll]);
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
            return { offset: 0, visible: [], pad: height, ranges: [] };
        }
        let start = 0;
        let offset = 0;
        let acc = 0;
        for (let i = 0; i < uiMessages.length; i++) {
            const h = uiMessages[i].height;
            if (acc + h > scrollTop) {
                start = i;
                offset = acc;
                break;
            }
            acc += h;
        }
        const visible = [];
        const ranges = [];
        let used = offset;
        for (let i = start; i < uiMessages.length; i++) {
            const h = uiMessages[i].height;
            if (used - offset + h > height)
                break;
            visible.push(uiMessages[i]);
            ranges.push({
                key: messageKey(uiMessages[i].view),
                kind: collapsibleKind(uiMessages[i].view) ?? "user",
                startRow: used,
                endRow: used + h,
            });
            used += h;
        }
        return { offset, visible, pad: Math.max(0, height - (used - offset)), ranges };
    }, [uiMessages, scrollTop, height]);
    // 鼠标：滚轮滚动 + 点击折叠头
    const rangesRef = useRef([]);
    rangesRef.current = window.ranges;
    const widthRef = useRef(width);
    widthRef.current = width;
    useEffect(() => {
        if (!onRegisterMouse)
            return;
        return onRegisterMouse((e) => {
            if (e.type === "wheel") {
                if (e.dx > 0) {
                    // 向下滚 → 内容下移（若已在底部则跟随）
                    const next = clamp(scrollTopRef.current + 3);
                    setScrollTop(next);
                    if (next >= maxScrollRef.current)
                        setFollow(true);
                }
                else {
                    setFollow(false);
                    setScrollTop(clamp(scrollTopRef.current - 3));
                }
                return true;
            }
            if (e.type === "mousedown" && e.button === 0) {
                // 命中检测：消息区占据屏幕第 1 行起（statusbar 在最底部）
                const areaRow = e.y - 1;
                if (areaRow < 0)
                    return false;
                for (const range of rangesRef.current) {
                    if (areaRow >= range.startRow && areaRow < range.endRow) {
                        if (range.kind !== "user" && areaRow === range.startRow) {
                            getStore().toggleExpanded(expandedId(range.kind, range.key));
                            return true;
                        }
                        return true;
                    }
                }
                return false;
            }
            return false;
        });
    }, [onRegisterMouse, clamp]);
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
    return (_jsxs(Box, { flexDirection: "column", width: width, height: height, paddingLeft: 1, paddingRight: 1, children: [_jsxs(Box, { flexGrow: 1, flexDirection: "column", overflow: "hidden", children: [window.offset > 0 ? _jsx(Box, { height: window.offset }) : null, window.visible.map((um) => (_jsx(Box, { flexDirection: "column", height: um.height, children: _jsx(MessageBlock, { view: um.view, theme: theme, width: textWidth, expanded: expandedFor(um.view, expanded), spinFrame: um.view.kind === "tool" && um.view.tool.status === "running" ? spinFrame : undefined }) }, messageKey(um.view)))), window.pad > 0 ? _jsx(Box, { flexGrow: 1, height: window.pad }) : null] }), _jsxs(Box, { flexDirection: "column", children: [workingLine, busy ? (_jsxs(Text, { color: theme.textMuted, bold: true, children: ["press ", _jsx(Text, { color: theme.text, bold: true, children: "esc" }), " to exit cancel"] })) : (helpLine)] })] }));
}
function expandedFor(view, expanded) {
    const key = messageKey(view);
    return {
        thinking: view.kind === "assistant" && view.thinking !== "" && expanded[expandedId("thinking", key)] === true,
        tool: view.kind === "tool" && expanded[expandedId("tool", key)] === true,
    };
}
//# sourceMappingURL=Messages.js.map