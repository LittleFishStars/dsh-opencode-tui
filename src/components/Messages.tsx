/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行。
 */
import React, { useMemo, useRef, useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { MessageView } from "../projection.js";
import type { Theme } from "../theme.js";
import { MessageBlock, estimateMessageHeight } from "./Message.js";
import { truncate } from "../util.js";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface UiMessage {
  view: MessageView;
  height: number;
}

/** 消息稳定 id（供 React key / memo）。 */
export function messageKey(view: MessageView): string {
  if (view.kind === "user") return view.id;
  if (view.kind === "assistant") return view.id;
  return view.tool.id;
}

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

function workingTask(messages: MessageView[]): string | null {
  if (messages.length === 0) return null;
  const hasRunningTool = messages.some((m) => m.kind === "tool" && m.tool.status === "running");
  if (hasRunningTool) return "Waiting for tool response...";
  const last = messages[messages.length - 1];
  if (last?.kind === "assistant" && !last.assembled) return "Generating...";
  if (last?.kind === "assistant" && !last.finished) return "Building tool call...";
  return "Thinking...";
}

export function Messages({
  messages,
  width,
  height,
  theme,
  busy,
  task,
  spinFrame,
  showInitial,
  brand,
  loading,
}: MessagesProps): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const [follow, setFollow] = useState(true);
  const scrollTopRef = useRef(scrollTop);
  const followRef = useRef(follow);
  scrollTopRef.current = scrollTop;
  followRef.current = follow;

  const uiMessages = useMemo<UiMessage[]>(() => {
    const textWidth = Math.max(10, width - 3);
    return messages.map((view) => ({
      view,
      height: estimateMessageHeight(view, textWidth),
    }));
  }, [messages, width]);

  const totalHeight = useMemo(() => {
    if (uiMessages.length === 0) return 0;
    return uiMessages.reduce((acc, m) => acc + m.height + 1, 0) - 1;
  }, [uiMessages]);

  const maxScroll = Math.max(0, totalHeight - height);

  // 新内容到来时跟随底部
  const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : 0;
  useEffect(() => {
    if (followRef.current) {
      setScrollTop(maxScroll);
    }
  }, [lastSeq, maxScroll, follow]);

  const clamp = (v: number) => Math.max(0, Math.min(maxScroll, v));

  useInput((_input, key) => {
    if (key.pageDown) {
      setFollow(false);
      setScrollTop((prev) => clamp(prev + Math.max(1, Math.floor(height / 2))));
    } else if (key.pageUp) {
      setFollow(false);
      setScrollTop((prev) => clamp(prev - Math.max(1, Math.floor(height / 2))));
    } else if (key.ctrl && key.upArrow) {
      setFollow(false);
      setScrollTop((prev) => clamp(prev - 1));
    } else if (key.ctrl && key.downArrow) {
      setFollow(false);
      setScrollTop((prev) => clamp(prev + 1));
    }
  });

  // 渲染窗口：覆盖 [scrollTop, scrollTop+height]，只包含能完整放下的消息
  const window = useMemo(() => {
    if (uiMessages.length === 0) {
      return { offset: 0, visible: [] as UiMessage[], pad: height };
    }
    let start = 0;
    let offset = 0;
    let acc = 0;
    for (let i = 0; i < uiMessages.length; i++) {
      const h = uiMessages[i]!.height + 1;
      if (acc + h > scrollTop) {
        start = i;
        offset = acc;
        break;
      }
      acc += h;
    }
    const visible: UiMessage[] = [];
    let used = offset;
    for (let i = start; i < uiMessages.length; i++) {
      const h = uiMessages[i]!.height + 1;
      if (used - offset + h > height) break;
      visible.push(uiMessages[i]!);
      used += h;
    }
    return { offset, visible, pad: Math.max(0, height - (used - offset)) };
  }, [uiMessages, scrollTop, height]);

  // 底部工作行 + 帮助行（opencode 风格）
  const workingLine = ((): React.ReactElement | null => {
    if (!busy || messages.length === 0) return null;
    const taskText = task ?? workingTask(messages) ?? "Thinking...";
    const frame = SPINNER_FRAMES[spinFrame % SPINNER_FRAMES.length]!;
    return (
      <Text color={theme.primary} bold={true}>
        {frame} {taskText}
      </Text>
    );
  })();

  const helpLine = (
    <Text color={theme.textMuted} bold={true}>
      press <Text color={theme.text} bold={true}>enter</Text> to send the message, write <Text color={theme.text} bold={true}>\
      </Text> and enter to add a new line
    </Text>
  );

  if (showInitial) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingLeft={1} paddingRight={1}>
        <Box flexGrow={1} flexDirection="column" justifyContent="center">
          <Text color={theme.primary} bold={true}>
            {brand}
          </Text>
          <Text color={theme.textMuted}>{truncate(`dsh agent — opencode-style TUI. ctrl+? for help.`, width - 4)}</Text>
        </Box>
        {helpLine}
      </Box>
    );
  }

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingLeft={1} paddingRight={1}>
        <Text color={theme.textMuted}>Loading...</Text>
        <Text color={theme.textMuted}>press esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} paddingLeft={1} paddingRight={1}>
      <Box flexGrow={1} flexDirection="column" overflow="hidden">
        {/* 顶部偏移 spacer */}
        {window.offset > 0 ? <Box height={window.offset} /> : null}
        {window.visible.map((um) => (
          <Box key={messageKey(um.view)} flexDirection="column" height={um.height}>
            <MessageBlock view={um.view} theme={theme} width={Math.max(10, width - 3)} />
          </Box>
        ))}
        {/* 底部的空行间隔 + 填充 */}
        {window.pad > 0 ? <Box flexGrow={1} height={window.pad} /> : null}
      </Box>
      <Box flexDirection="column">
        {workingLine}
        {busy ? (
          <Text color={theme.textMuted} bold={true}>
            press <Text color={theme.text} bold={true}>esc</Text> to exit cancel
          </Text>
        ) : (
          helpLine
        )}
      </Box>
    </Box>
  );
}
