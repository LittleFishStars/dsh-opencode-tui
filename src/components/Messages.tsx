/**
 * 消息列表：虚拟滚动 + 跟随底部 + opencode 风格的 working/help 行 + 鼠标支持。
 *
 * 滚动数学（行数）与渲染布局严格一致：每条消息高度 = 估算高度（含安全余量），
 * 无额外行距；顶部用 offset spacer 对齐窗口。
 */
import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { MessageView } from "../projection.js";
import type { Theme } from "../theme.js";
import { MessageBlock, estimateMessageHeight, collapsibleKind, expandedId, type BodyExpanded } from "./Message.js";
import { SPINNER_FRAMES, truncate } from "../util.js";
import { getStore } from "../store.js";
import type { MouseEventData } from "../mouse.js";

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

/** 命中区间（屏幕行号，1-based 屏幕坐标 → 区域内行号 = y - 1）。 */
interface HitRange {
  key: string;
  kind: "thinking" | "tool" | "user";
  startRow: number;
  endRow: number;
}

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
  expanded,
  showInitial,
  brand,
  loading,
  onRegisterMouse,
}: MessagesProps): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const [follow, setFollow] = useState(true);
  const scrollTopRef = useRef(scrollTop);
  const followRef = useRef(follow);
  scrollTopRef.current = scrollTop;
  followRef.current = follow;

  const textWidth = Math.max(10, width - 3);

  const uiMessages = useMemo<UiMessage[]>(() => {
    return messages.map((view) => {
      const key = messageKey(view);
      const exp: BodyExpanded = {
        thinking: view.kind === "assistant" && view.thinking !== "" && expanded[expandedId("thinking", key)] === true,
        tool: view.kind === "tool" && expanded[expandedId("tool", key)] === true,
      };
      return { view, height: estimateMessageHeight(view, textWidth, exp) };
    });
  }, [messages, textWidth, expanded]);

  const totalHeight = useMemo(() => {
    if (uiMessages.length === 0) return 0;
    return uiMessages.reduce((acc, m) => acc + m.height, 0);
  }, [uiMessages]);

  const maxScroll = Math.max(0, totalHeight - height);
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  const clamp = useCallback((v: number) => Math.max(0, Math.min(maxScrollRef.current, v)), []);

  // 新内容到来时跟随底部
  const lastSeq = messages.length > 0 ? messages[messages.length - 1]!.seq : 0;
  useEffect(() => {
    if (followRef.current) {
      setScrollTop(maxScrollRef.current);
    }
    // 滚动位置超出新上限时收拢
    else if (scrollTopRef.current > maxScrollRef.current) {
      setScrollTop(maxScrollRef.current);
    }
  }, [lastSeq, maxScroll]);

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
      return { offset: 0, visible: [] as UiMessage[], pad: height, ranges: [] as HitRange[] };
    }
    let start = 0;
    let offset = 0;
    let acc = 0;
    for (let i = 0; i < uiMessages.length; i++) {
      const h = uiMessages[i]!.height;
      if (acc + h > scrollTop) {
        start = i;
        offset = acc;
        break;
      }
      acc += h;
    }
    const visible: UiMessage[] = [];
    const ranges: HitRange[] = [];
    let used = offset;
    for (let i = start; i < uiMessages.length; i++) {
      const h = uiMessages[i]!.height;
      if (used - offset + h > height) break;
      visible.push(uiMessages[i]!);
      ranges.push({
        key: messageKey(uiMessages[i]!.view),
        kind: collapsibleKind(uiMessages[i]!.view) ?? "user",
        startRow: used,
        endRow: used + h,
      });
      used += h;
    }
    return { offset, visible, pad: Math.max(0, height - (used - offset)), ranges };
  }, [uiMessages, scrollTop, height]);

  // 鼠标：滚轮滚动 + 点击折叠头
  const rangesRef = useRef<HitRange[]>([]);
  rangesRef.current = window.ranges;
  const widthRef = useRef(width);
  widthRef.current = width;
  useEffect(() => {
    if (!onRegisterMouse) return;
    return onRegisterMouse((e: MouseEventData) => {
      if (e.type === "wheel") {
        if (e.dx > 0) {
          // 向下滚 → 内容下移（若已在底部则跟随）
          const next = clamp(scrollTopRef.current + 3);
          setScrollTop(next);
          if (next >= maxScrollRef.current) setFollow(true);
        } else {
          setFollow(false);
          setScrollTop(clamp(scrollTopRef.current - 3));
        }
        return true;
      }
      if (e.type === "mousedown" && e.button === 0) {
        // 命中检测：消息区占据屏幕第 1 行起（statusbar 在最底部）
        const areaRow = e.y - 1;
        if (areaRow < 0) return false;
        for (const range of rangesRef.current) {
          if (areaRow >= range.startRow && areaRow < range.endRow) {
            if (range.kind !== "user" && areaRow === range.startRow) {
              getStore().toggleExpanded(expandedId(range.kind as "thinking" | "tool", range.key));
              return true;
            }
            return true;
          }
        }
        return false;
      }
      return false;
    });
  }, [onRegisterMouse, clamp]);

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
            <MessageBlock view={um.view} theme={theme} width={textWidth} expanded={expandedFor(um.view, expanded)} spinFrame={um.view.kind === "tool" && um.view.tool.status === "running" ? spinFrame : undefined} />
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

function expandedFor(view: MessageView, expanded: Record<string, boolean>): BodyExpanded {
  const key = messageKey(view);
  return {
    thinking: view.kind === "assistant" && view.thinking !== "" && expanded[expandedId("thinking", key)] === true,
    tool: view.kind === "tool" && expanded[expandedId("tool", key)] === true,
  };
}
