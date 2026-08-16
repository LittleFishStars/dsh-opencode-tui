import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * 右侧面板（opencode 风格）：Session 信息 + 修改文件列表。
 * 会话激活时才显示。
 */
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { execFile } from "node:child_process";
import { truncate, widthOf } from "../util.js";
/** 运行 git status --porcelain 获取修改文件（带增删行数）。 */
function loadModifiedFiles(cwd) {
    return new Promise((resolve) => {
        execFile("git", ["status", "--porcelain", "--short"], { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 5000 }, (error, stdout) => {
            if (error) {
                resolve([]);
                return;
            }
            const files = [];
            for (const line of stdout.split("\n")) {
                if (line.trim() === "")
                    continue;
                const status = line.slice(0, 2);
                const path = line.slice(3).trim();
                if (path === "")
                    continue;
                if (/^R/.test(status))
                    continue; // 重命名交给 diff 显示
                files.push({ path, additions: 0, removals: 0 });
            }
            resolve(files.slice(0, 30));
        });
    });
}
function loadDiffStats(cwd, paths) {
    if (paths.length === 0)
        return Promise.resolve(new Map());
    return new Promise((resolve) => {
        execFile("git", ["diff", "--numstat", "--", ...paths], { cwd, maxBuffer: 2 * 1024 * 1024, timeout: 5000 }, (error, stdout) => {
            const map = new Map();
            if (error) {
                resolve(map);
                return;
            }
            for (const line of stdout.split("\n")) {
                const parts = line.split("\t");
                if (parts.length < 3)
                    continue;
                const add = Number.parseInt(parts[0], 10);
                const del = Number.parseInt(parts[1], 10);
                map.set(parts[2], {
                    add: Number.isNaN(add) ? 0 : add,
                    del: Number.isNaN(del) ? 0 : del,
                });
            }
            resolve(map);
        });
    });
}
export function Sidebar({ theme, width, height, session, model, cwd }) {
    const [modFiles, setModFiles] = useState([]);
    const sessionId = session?.id ?? null;
    useEffect(() => {
        if (!sessionId) {
            setModFiles([]);
            return;
        }
        let cancelled = false;
        const refresh = async () => {
            const files = await loadModifiedFiles(cwd);
            if (cancelled)
                return;
            const stats = await loadDiffStats(cwd, files.map((f) => f.path));
            if (cancelled)
                return;
            setModFiles(files.map((f) => {
                const s = stats.get(f.path);
                return { ...f, additions: s?.add ?? 0, removals: s?.del ?? 0 };
            }));
        };
        void refresh();
        const timer = setInterval(() => void refresh(), 8000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [sessionId, cwd]);
    const bg = theme.sidebarBg;
    const textWidth = Math.max(10, width - 2);
    /** 满宽灰底行：内容 + 空格填充到整行（嵌套 Text 继承父背景）。 */
    const line = (children, pad = 0, color) => (_jsxs(Text, { backgroundColor: bg, color: color, children: [children, " ".repeat(Math.max(0, textWidth - pad))] }));
    const rowLine = (label, value) => {
        const v = truncate(value, Math.max(5, textWidth - label.length - 3));
        return line(_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.primary, bold: true, children: label }), _jsxs(Text, { color: theme.text, children: [": ", v] })] }), widthOf(label) + 2 + widthOf(v));
    };
    const fileLine = (f) => {
        const stats = `${f.additions > 0 ? ` +${f.additions}` : ""}${f.removals > 0 ? ` -${f.removals}` : ""}`;
        const path = truncate(f.path, Math.max(5, textWidth - widthOf(stats) - 2));
        return line(_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.text, children: path }), f.additions > 0 ? _jsx(Text, { color: theme.success, children: ` +${f.additions}` }) : null, f.removals > 0 ? _jsx(Text, { color: theme.error, children: ` -${f.removals}` }) : null] }), widthOf(path) + widthOf(stats));
    };
    const rows = [];
    rows.push(line(_jsxs(Text, { color: theme.primary, bold: true, children: [" ", "dsh \u232C opencode"] }), widthOf(" dsh ⌬ opencode")));
    rows.push(line(" "));
    if (session) {
        rows.push(rowLine("Session", session.title || "New Session"));
        rows.push(rowLine("Model", model ? `${model.provider}/${model.model}` : "-"));
        rows.push(rowLine("CWD", cwd));
        rows.push(rowLine("Messages", String(session.messageCount)));
    }
    else {
        rows.push(line(_jsx(Text, { color: theme.textMuted, children: " No active session" }), widthOf(" No active session")));
    }
    rows.push(line(" "));
    rows.push(line(_jsxs(Text, { color: theme.primary, bold: true, children: [" ", "Modified Files:"] }), widthOf(" Modified Files:")));
    if (modFiles.length === 0) {
        rows.push(line(_jsx(Text, { color: theme.textMuted, children: " No modified files" }), widthOf(" No modified files")));
    }
    else {
        for (const f of modFiles)
            rows.push(fileLine(f));
    }
    rows.push(line(" "));
    rows.push(line(_jsx(Text, { color: theme.textMuted, dimColor: true, children: " ctrl+s sessions \u00B7 ctrl+k commands" })));
    // 超高时截断（sidebar 不滚动）
    return (_jsx(Box, { flexDirection: "column", height: height, overflow: "hidden", children: rows }));
}
//# sourceMappingURL=Sidebar.js.map