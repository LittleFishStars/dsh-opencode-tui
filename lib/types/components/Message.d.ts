/**
 * 单条消息渲染（opencode 风格）：
 * - 用户消息：左侧粗边框 + 次要色（蓝）
 * - 助手消息：左侧粗边框 + 主色（橙），markdown，完成时附 "(model · took)"
 * - 工具调用：左侧粗边框 + 弱化色，`Name: params` 头 + 结果体
 */
import React from "react";
import type { MessageView } from "../projection.js";
import type { Theme } from "../theme.js";
export declare const MAX_RESULT_HEIGHT = 10;
/** 消息内边距：左边框 + 内容 padding。 */
export declare const MSG_BORDER = 1;
export declare const MSG_PADDING = 1;
/** 消息可用文本宽度。 */
export declare function msgTextWidth(areaWidth: number): number;
export interface BodyExpanded {
    thinking: boolean;
    tool: boolean;
}
/** 渲染单条消息（完整）。 */
export declare const MessageBlock: React.NamedExoticComponent<{
    view: MessageView;
    theme: Theme;
    width: number;
    expanded: BodyExpanded;
    spinFrame?: number;
}>;
/** 估算一条消息渲染后的行数（含 1 行安全余量；折叠感知）。 */
export declare function estimateMessageHeight(view: MessageView, width: number, expanded: BodyExpanded): number;
/** 折叠块稳定 id。 */
export declare function expandedId(kind: "thinking" | "tool", key: string): string;
/** 消息是否含可折叠块（供鼠标命中判断）。 */
export declare function collapsibleKind(view: MessageView): "thinking" | "tool" | null;
