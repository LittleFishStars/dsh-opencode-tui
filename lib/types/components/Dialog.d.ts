/**
 * 对话框（opencode 风格居中覆盖层）：
 * - Dialog 外壳：绝对定位 + flex 居中
 * - ListDialog：j/k 导航 + 过滤输入（sessions / commands / models / themes）
 * - ConfirmDialog：确认框（quit / approval）
 * - HelpDialog：键位帮助
 */
import React from "react";
import type { Theme } from "../theme.js";
import type { KeyBinding } from "../keys.js";
import type { MouseEventData } from "../mouse.js";
export interface DialogItem {
    id: string;
    title: string;
    subtitle?: string;
    /** 图标字符（可选） */
    icon?: string;
}
/** 对话框尺寸（屏幕宽高 → 对话框宽高）。 */
export declare function dialogSize(width: number, height: number): {
    width: number;
    height: number;
};
/** 对话框外壳：全屏覆盖层 + 居中 + 深灰背景 + 矩形上报（鼠标命中用）。 */
export declare function Dialog({ theme, width, height, title, children, }: {
    theme: Theme;
    width: number;
    height: number;
    title: string;
    children: React.ReactNode;
}): React.ReactElement;
export interface ListDialogProps {
    theme: Theme;
    width: number;
    height: number;
    title: string;
    items: DialogItem[];
    /** 是否显示过滤输入框（sessions/commands/models） */
    filterable?: boolean;
    onConfirm: (item: DialogItem) => void;
    onClose: () => void;
    /** 空列表文案 */
    emptyText?: string;
    /** 注册鼠标处理器（点击条目/滚轮） */
    onRegisterMouse?: (handler: (e: MouseEventData) => boolean) => () => void;
}
export declare function ListDialog({ theme, width, height, title, items, filterable, onConfirm, onClose, emptyText, onRegisterMouse, }: ListDialogProps): React.ReactElement;
export interface ConfirmDialogProps {
    theme: Theme;
    width: number;
    height: number;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}
export declare function ConfirmDialog({ theme, width, height, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, }: ConfirmDialogProps): React.ReactElement;
export declare function HelpDialog({ theme, width, height, sections, }: {
    theme: Theme;
    width: number;
    height: number;
    sections: Array<{
        title: string;
        bindings: KeyBinding[];
    }>;
}): React.ReactElement;
