/**
 * 单条消息渲染（opencode 风格）：
 * - 用户消息：左侧粗边框 + 次要色（蓝）
 * - 助手消息：左侧粗边框 + 主色（橙），markdown，完成时附 "(model · took)"
 * - 工具调用：左侧粗边框 + 弱化色，`Name: params` 头 + 结果体
 */
import React from "react";
import { Box, Text } from "ink";
import type { MessageView, ToolCallView } from "../projection.js";
import { toolAction, toolDisplayName, toolParamSummary } from "../projection.js";
import type { Theme } from "../theme.js";
import { formatDuration, truncate } from "../util.js";
import { AnsiInline } from "../ansi.js";
import { Markdown } from "../markdown.js";

export const MAX_RESULT_HEIGHT = 10;

/** 消息内边距：左边框 + 内容 padding。 */
export const MSG_BORDER = 1;
export const MSG_PADDING = 1;

/** 消息可用文本宽度。 */
export function msgTextWidth(areaWidth: number): number {
  return Math.max(10, areaWidth - MSG_BORDER - MSG_PADDING - 2);
}

// ── 工具结果渲染（opencode 风格） ──────────────────────────────────────────

function renderToolResult(tool: ToolCallView, theme: Theme, width: number): React.ReactElement {
  if (tool.status === "error") {
    const errText = tool.error ? `${tool.error.name}: ${tool.error.code}` : "Error";
    const content = tool.result ? truncate(tool.result.replace(/\n/g, " "), width, "...") : "";
    return (
      <Text color={theme.error}>
        {errText}
        {content ? `: ${content}` : ""}
      </Text>
    );
  }
  const result = tool.result ?? "";
  switch (tool.name) {
    case "bash":
    case "bash_persistent":
    case "pwsh": {
      const lines = truncateLines(result, MAX_RESULT_HEIGHT);
      return (
        <Box flexDirection="column">
          {lines.map((line, i) => (
            <AnsiInline key={i} text={line} color={theme.text} />
          ))}
          {moreNote(result, theme)}
        </Box>
      );
    }
    case "fs_read":
    case "fs_write":
    case "fs_edit":
    case "view":
    case "write":
    case "edit":
    case "patch": {
      // 按扩展名高亮的代码块
      const lang = detectLang(tool);
      const lines = truncateLines(result, MAX_RESULT_HEIGHT);
      return (
        <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
          {lines.map((line, i) => (
            <Text key={i} color={theme.text}>
              {line || " "}
            </Text>
          ))}
          {moreNote(result, theme)}
        </Box>
      );
    }
    case "fs_search":
    case "fs_list":
    case "fs_glob":
    case "grep":
    case "ls":
    case "glob":
      return (
        <Box flexDirection="column">
          {truncateLines(result, MAX_RESULT_HEIGHT).map((line, i) => (
            <Text key={i} color={theme.textMuted}>
              {line}
            </Text>
          ))}
          {moreNote(result, theme)}
        </Box>
      );
    default:
      return (
        <Box flexDirection="column">
          {truncateLines(result, MAX_RESULT_HEIGHT).map((line, i) => (
            <AnsiInline key={i} text={line} color={theme.text} />
          ))}
          {moreNote(result, theme)}
        </Box>
      );
  }
}

function detectLang(tool: ToolCallView): string {
  let path = "";
  try {
    const args = JSON.parse(tool.arguments || "{}") as Record<string, unknown>;
    path = typeof args.file_path === "string" ? args.file_path : typeof args.path === "string" ? args.path : "";
  } catch {
    /* ignore */
  }
  const ext = path.split(".").pop();
  if (!ext || ext === path) return "";
  return ext.toLowerCase();
}

function truncateLines(text: string, max: number): string[] {
  const lines = text.split("\n");
  if (lines.length > max) return lines.slice(0, max);
  return lines;
}

function moreNote(text: string, theme: Theme): React.ReactElement | null {
  const lines = text.split("\n");
  if (lines.length <= MAX_RESULT_HEIGHT) return null;
  return <Text color={theme.textMuted}>… +{lines.length - MAX_RESULT_HEIGHT} more lines</Text>;
}

// ── 消息体 ──────────────────────────────────────────────────────────────────

function UserBody({ view, theme, width }: { view: Extract<MessageView, { kind: "user" }>; theme: Theme; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" width={width}>
      <Markdown md={view.content} theme={theme} width={width} />
    </Box>
  );
}

function AssistantBody({ view, theme, width }: { view: Extract<MessageView, { kind: "assistant" }>; theme: Theme; width: number }): React.ReactElement {
  const text = view.text;
  const showThinking = view.thinking !== "" && !view.assembled;
  const infoParts: string[] = [];
  if (view.finished) {
    const model = view.model ? view.model.split("/").pop() : undefined;
    const took = view.endedAt && view.time ? formatDuration(view.time, view.endedAt) : undefined;
    const reasonLabel =
      view.reason === "completed"
        ? undefined
        : view.reason === "aborted"
          ? "canceled"
          : view.reason === "error"
            ? "error"
            : view.reason;
    if (model) infoParts.push(model);
    if (took) infoParts.push(took);
    if (reasonLabel) infoParts.push(reasonLabel);
  }
  return (
    <Box flexDirection="column" width={width}>
      {showThinking ? (
        <Text color={theme.textMuted} italic={true}>
          {truncate(view.thinking.replace(/\s+/g, " "), Math.max(20, width - 4))}
        </Text>
      ) : null}
      {text !== "" ? (
        view.assembled ? (
          <Markdown md={text} theme={theme} width={width} />
        ) : (
          <Text color={theme.text} wrap="wrap">
            {text}
          </Text>
        )
      ) : (
        <Text color={theme.textMuted} italic={true}>
          {view.finished && view.empty ? "*Finished without output*" : "…"}
        </Text>
      )}
      {infoParts.length > 0 ? (
        <Text color={theme.textMuted}>{` (${infoParts.join(" · ")})`}</Text>
      ) : null}
    </Box>
  );
}

function ToolBody({ view, theme, width }: { view: Extract<MessageView, { kind: "tool" }>; theme: Theme; width: number }): React.ReactElement {
  const tool = view.tool;
  const nameText = toolDisplayName(tool.name);
  const paramsWidth = Math.max(10, width - nameText.length - 4);
  const params = toolParamSummary(tool.name, tool.arguments, paramsWidth);
  return (
    <Box flexDirection="column" width={width}>
      <Box flexDirection="row">
        <Text color={theme.textMuted}>{nameText}: </Text>
        {tool.status === "running" ? (
          <Text color={theme.textMuted} wrap="wrap">
            {toolAction(tool.name)}
          </Text>
        ) : (
          <Text color={theme.textMuted} wrap="wrap">
            {params || " "}
          </Text>
        )}
      </Box>
      {tool.status !== "running" ? (
        <Box marginTop={0}>{renderToolResult(tool, theme, width)}</Box>
      ) : null}
    </Box>
  );
}

/** 渲染单条消息（完整）。 */
export const MessageBlock = React.memo(function MessageBlock({
  view,
  theme,
  width,
}: {
  view: MessageView;
  theme: Theme;
  width: number;
}): React.ReactElement {
  const borderColor =
    view.kind === "user" ? theme.secondary : view.kind === "assistant" ? theme.primary : theme.border;
  return (
    <Box
      flexDirection="column"
      width={width + MSG_BORDER + MSG_PADDING}
      borderLeft={true}
      borderTop={false}
      borderBottom={false}
      borderRight={false}
      borderStyle="bold"
      borderColor={borderColor}
      paddingLeft={MSG_PADDING}
      paddingRight={MSG_PADDING}
    >
      {view.kind === "user" ? (
        <UserBody view={view} theme={theme} width={width} />
      ) : view.kind === "assistant" ? (
        <AssistantBody view={view} theme={theme} width={width} />
      ) : (
        <ToolBody view={view} theme={theme} width={width} />
      )}
    </Box>
  );
});

// ── 高度估算（虚拟滚动用） ────────────────────────────────────────────────

import { estimateLines } from "../util.js";

/** 估算一条消息渲染后的行数（含 1 行安全余量）。 */
export function estimateMessageHeight(view: MessageView, width: number): number {
  const textWidth = Math.max(10, width);
  let lines = 0;
  if (view.kind === "user") {
    lines = estimateLines(view.content, textWidth);
  } else if (view.kind === "assistant") {
    if (view.thinking !== "" && !view.assembled) lines += 1;
    if (view.text !== "") lines += estimateLines(view.text, textWidth);
    else lines += 1;
    if (view.finished) lines += 1;
  } else {
    lines += 1; // 头部行
    const tool = view.tool;
    if (tool.status !== "running") {
      const result = tool.result ?? "";
      if (tool.status === "error") {
        lines += 1;
      } else {
        const rl = Math.min(MAX_RESULT_HEIGHT, result.split("\n").length);
        lines += rl;
        if (result.split("\n").length > MAX_RESULT_HEIGHT) lines += 1;
      }
    }
  }
  return lines + 1; // 安全余量
}
