/**
 * 主应用：opencode 风格三区布局（消息 / 编辑器 / 可选右侧栏）+ 底部状态栏，
 * 全局键位路由 + 对话框编排 + spinner。
 */
import React from "react";
import { type DialogItem } from "./Dialog.js";
export interface TuiActions {
    send: (text: string) => void;
    cancel: () => void;
    newSession: () => void;
    switchSession: (sessionId: string) => void;
    setTheme: (name: string) => void;
    quit: () => void;
    /** 外部编辑器 */
    openExternalEditor: (current: string, done: (text: string) => void) => void;
    /** 选择文件（返回选中路径） */
    pickFile: (prefix: string, done: (path: string) => void) => void;
    /** 命令动作 */
    runCommand: (id: string) => void;
}
export interface TuiAppProps {
    actions: TuiActions;
    brand: string;
    commands: DialogItem[];
    mouse: MouseController;
}
export declare function TuiApp({ actions, brand, commands, mouse }: TuiAppProps): React.ReactElement;
import type { MouseController } from "../mouse.js";
