/**
 * 右侧面板（opencode 风格）：Session 信息 + 修改文件列表。
 * 会话激活时才显示。
 */
import React from "react";
import type { Theme } from "../theme.js";
import type { SessionMeta } from "../projection.js";
export interface SidebarProps {
    theme: Theme;
    width: number;
    height: number;
    session: SessionMeta | null;
    model: {
        provider: string;
        model: string;
    } | null;
    cwd: string;
}
export declare function Sidebar({ theme, width, height, session, model, cwd }: SidebarProps): React.ReactElement;
