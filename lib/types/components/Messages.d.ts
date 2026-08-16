/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行。
 */
import React from "react";
import type { MessageView } from "../projection.js";
import type { Theme } from "../theme.js";
export declare const SPINNER_FRAMES: string[];
/** 消息稳定 id（供 React key / memo）。 */
export declare function messageKey(view: MessageView): string;
export interface MessagesProps {
    messages: MessageView[];
    width: number;
    height: number;
    theme: Theme;
    busy: boolean;
    task: string;
    spinFrame: number;
    /** 是否显示初始屏（无会话时） */
    showInitial: boolean;
    /** 初始屏标题（如 opencode ⌬） */
    brand: string;
    /** 加载中（会话切换） */
    loading: boolean;
    onPageUp?: () => void;
    onPageDown?: () => void;
}
export declare function Messages({ messages, width, height, theme, busy, task, spinFrame, showInitial, brand, loading, }: MessagesProps): React.ReactElement;
