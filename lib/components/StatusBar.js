import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { truncate } from "../util.js";
export function StatusBar({ theme, width, notification, model, sessionLabel, busy }) {
    const helpWidget = (_jsx(Text, { backgroundColor: theme.textMuted, color: theme.backgroundDarker, bold: true, children: " ctrl+? help " }));
    const middleWidth = Math.max(0, width - 24);
    let middle;
    if (notification) {
        const bg = notification.type === "error" ? theme.error : notification.type === "warn" ? theme.warning : theme.info;
        middle = (_jsx(Text, { backgroundColor: bg, color: theme.background, bold: true, children: ` ${truncate(notification.message, Math.max(5, middleWidth - 2))} ` }));
    }
    else {
        middle = (_jsx(Text, { backgroundColor: theme.backgroundSecondary, color: theme.text, children: " " }));
    }
    const rightText = [
        model ? `${model.provider}/${model.model}` : null,
        sessionLabel,
        busy ? "working..." : null,
    ]
        .filter((s) => s !== null)
        .join(" · ");
    const right = (_jsx(Text, { backgroundColor: theme.backgroundDarker, color: theme.text, dimColor: true, children: ` ${truncate(rightText, Math.max(5, middleWidth - 2))} ` }));
    return (_jsxs(Box, { flexDirection: "row", width: width, height: 1, children: [helpWidget, _jsx(Box, { width: Math.max(0, width - 22), children: middle }), right] }));
}
//# sourceMappingURL=StatusBar.js.map