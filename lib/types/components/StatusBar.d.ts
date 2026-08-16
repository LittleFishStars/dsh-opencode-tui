/**
 * 底部状态栏（opencode 风格）：
 * [ctrl+? help] [通知/空白] [模型 · 会话信息]
 */
import React from "react";
import type { Theme } from "../theme.js";
import type { Notification } from "../store.js";
export interface StatusBarProps {
    theme: Theme;
    width: number;
    notification: Notification | null;
    model: {
        provider: string;
        model: string;
    } | null;
    sessionLabel: string | null;
    busy: boolean;
}
export declare function StatusBar({ theme, width, notification, model, sessionLabel, busy }: StatusBarProps): React.ReactElement;
