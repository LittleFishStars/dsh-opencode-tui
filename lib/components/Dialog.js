import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * 对话框（opencode 风格居中覆盖层）：
 * - Dialog 外壳：绝对定位 + flex 居中
 * - ListDialog：j/k 导航 + 过滤输入（sessions / commands / models / themes）
 * - ConfirmDialog：确认框（quit / approval）
 * - HelpDialog：键位帮助
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { truncate } from "../util.js";
/** 对话框外壳：全屏覆盖层 + 居中。 */
export function Dialog({ theme, width, height, title, children, }) {
    const dialogWidth = Math.min(width - 6, 60);
    const dialogHeight = Math.min(height - 4, 24);
    return (_jsx(Box, { position: "absolute", width: width, height: height, flexDirection: "column", alignItems: "center", justifyContent: "center", children: _jsxs(Box, { width: dialogWidth, height: dialogHeight, flexDirection: "column", borderStyle: "round", borderColor: theme.borderFocused, paddingLeft: 1, paddingRight: 1, children: [_jsx(Text, { bold: true, color: theme.primary, children: title }), _jsx(Box, { height: 1 }), children] }) }));
}
export function ListDialog({ theme, width, height, title, items, filterable = true, onConfirm, onClose, emptyText = "No items", }) {
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState(0);
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (q === "")
            return items;
        return items.filter((i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q));
    }, [items, filter]);
    useEffect(() => {
        if (selected >= filtered.length)
            setSelected(Math.max(0, filtered.length - 1));
    }, [filtered.length, selected]);
    useInput((input, key) => {
        if (key.escape) {
            onClose();
            return;
        }
        if (key.upArrow || (key.ctrl === false && input === "k")) {
            setSelected((prev) => Math.max(0, prev - 1));
            return;
        }
        if (key.downArrow || (key.ctrl === false && input === "j")) {
            setSelected((prev) => Math.min(filtered.length - 1, prev + 1));
            return;
        }
        if (key.return) {
            const item = filtered[selectedRef.current];
            if (item)
                onConfirm(item);
            return;
        }
        if (filterable) {
            if (key.backspace) {
                setFilter((prev) => prev.slice(0, -1));
                return;
            }
            if (key.ctrl === false && input.length > 0) {
                setFilter((prev) => prev + input);
                return;
            }
        }
    });
    const visible = filtered.slice(0, Math.max(1, height - 8));
    const listHeight = Math.max(1, height - 8);
    return (_jsxs(Dialog, { theme: theme, width: width, height: height, title: title, children: [filterable ? (_jsxs(Box, { flexDirection: "row", marginBottom: 1, children: [_jsx(Text, { color: theme.textMuted, children: "/ " }), _jsx(Text, { color: theme.text, children: filter || _jsx(Text, { color: theme.textMuted, dimColor: true, children: "filter..." }) })] })) : null, _jsx(Box, { flexDirection: "column", height: listHeight, children: visible.length === 0 ? (_jsx(Text, { color: theme.textMuted, children: emptyText })) : (visible.map((item, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: i === selectedRef.current ? theme.primary : theme.textMuted, children: i === selectedRef.current ? "› " : "  " }), _jsxs(Text, { color: i === selectedRef.current ? theme.text : theme.textMuted, bold: i === selectedRef.current, children: [item.icon ? `${item.icon} ` : "", truncate(item.title, Math.max(10, width - 16))] }), item.subtitle ? (_jsxs(Text, { color: theme.textMuted, dimColor: true, children: ["  ", truncate(item.subtitle, Math.max(5, width - 40))] })) : null] }, item.id)))) }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.textMuted, dimColor: true, children: "\u2191/\u2193 or k/j navigate \u00B7 enter select \u00B7 esc close" })] }));
}
export function ConfirmDialog({ theme, width, height, title, message, confirmLabel = "Yes", cancelLabel = "No", onConfirm, onCancel, }) {
    const [yes, setYes] = useState(true);
    useInput((_input, key) => {
        if (key.escape || key.leftArrow || key.rightArrow) {
            setYes((prev) => !prev);
            return;
        }
        if (key.return) {
            if (yes)
                onConfirm();
            else
                onCancel();
            return;
        }
        if (key.tab) {
            setYes((prev) => !prev);
        }
    });
    return (_jsxs(Dialog, { theme: theme, width: width, height: height, title: title, children: [_jsx(Text, { color: theme.text, wrap: "wrap", children: message }), _jsx(Box, { height: 1 }), _jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: yes ? theme.background : theme.textMuted, backgroundColor: yes ? theme.primary : undefined, bold: yes, children: yes ? ` [${confirmLabel}] ` : ` ${confirmLabel} ` }), _jsx(Text, { children: " " }), _jsx(Text, { color: !yes ? theme.background : theme.textMuted, backgroundColor: !yes ? theme.textMuted : undefined, bold: !yes, children: !yes ? ` [${cancelLabel}] ` : ` ${cancelLabel} ` })] })] }));
}
export function HelpDialog({ theme, width, height, sections, }) {
    const rows = [];
    for (const section of sections) {
        for (const binding of section.bindings) {
            rows.push({ key: binding.keys[0], help: binding.help, description: binding.description, section: section.title });
        }
    }
    const visible = rows.slice(0, Math.max(1, height - 10));
    return (_jsxs(Dialog, { theme: theme, width: width, height: height, title: "Help", children: [_jsx(Box, { flexDirection: "column", children: visible.map((row, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 10, children: _jsx(Text, { color: theme.textMuted, children: row.section }) }), _jsx(Box, { width: 12, children: _jsx(Text, { color: theme.primary, bold: true, children: row.help }) }), _jsx(Text, { color: theme.text, children: row.description })] }, i))) }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.textMuted, dimColor: true, children: "esc to close" })] }));
}
//# sourceMappingURL=Dialog.js.map