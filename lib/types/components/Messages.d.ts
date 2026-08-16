/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行 + 鼠标支持。
 *
 * 滚动数学（行数）与渲染布局严格一致：每条消息高度 = 估算高度（含安全余量），
 * 无额外行距；顶部用 offset spacer 对齐窗口。
 */
import React from "react";
import type { MessageView } from "../projection.js";
import type { Theme } from "../theme.js";
import type { MouseEventData } from "../mouse.js";
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
    /** 折叠块展开状态 map（thinking:<key> / tool:<key>） */
    expanded: Record<string, boolean>;
    /** 是否显示初始屏（无会话时） */
    showInitial: boolean;
    /** 初始屏标题（如 opencode ⌬） */
    brand: string;
    /** 加载中（会话切换） */
    loading: boolean;
    /** 注册鼠标处理器（返回 true = 已消费） */
    onRegisterMouse?: (handler: (e: MouseEventData) => boolean) => () => void;
}
export declare function Messages({ messages, width, height, theme, busy, task, spinFrame, expanded, showInitial, brand, loading, onRegisterMouse, }: MessagesProps): React.ReactElement;
