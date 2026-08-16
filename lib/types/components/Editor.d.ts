/**
 * 输入编辑器（opencode 风格）：
 * - `>` 提示符 + 光标块渲染 + placeholder
 * - Enter 发送；行尾 `\` + Enter 换行
 * - Ctrl+A/E 行首尾、Ctrl+K 杀到行尾、Ctrl+W 杀词、Ctrl+E 外部编辑器
 * - 多行输入，最多展示 MAX_LINES 行（随光标滚动）
 */
import React from "react";
import type { Theme } from "../theme.js";
export interface EditorProps {
    theme: Theme;
    width: number;
    /** 是否可发送（agent 忙碌时 opencode 禁止发送） */
    canSend: boolean;
    placeholder?: string;
    onSubmit: (text: string) => void;
    /** Ctrl+E 外部编辑器 */
    onExternalEditor: (current: string, setValue: (v: string) => void) => void;
    /** @ 完成回调（返回 true 表示已消费） */
    onAtComplete?: () => void;
    /** / 命令菜单打开（在输入框上方显示命令建议） */
    onSlash?: (query: string) => void;
    /** 注册外部 setValue（文件选择器等插入文本用） */
    onRegisterEditor?: (setValue: (text: string) => void) => void;
    /** 值变化回调（App 用于判断输入区是否为空） */
    onValueChange?: (value: string) => void;
    /** 空输入时按 "?" 触发帮助（opencode 行为） */
    onHelpRequest?: () => void;
    /** agent 忙时按 Enter（opencode: "Agent is working, please wait..."） */
    onSendBlocked?: () => void;
    disabled?: boolean;
}
export declare function Editor({ theme, width, canSend, placeholder, onSubmit, onExternalEditor, onAtComplete, onRegisterEditor, onValueChange, onHelpRequest, onSendBlocked, disabled, }: EditorProps): React.ReactElement;
