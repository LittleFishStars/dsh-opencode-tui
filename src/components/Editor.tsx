/**
 * 输入编辑器（opencode 风格）：
 * - `>` 提示符 + 光标块渲染 + placeholder
 * - Enter 发送；行尾 `\` + Enter 换行
 * - Ctrl+A/E 行首尾、Ctrl+K 杀到行尾、Ctrl+W 杀词、Ctrl+E 外部编辑器
 * - 多行输入，最多展示 MAX_LINES 行（随光标滚动）
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "../theme.js";
import { getStore, getQuestionQueue } from "../store.js";
import { widthOf } from "../util.js";

const MAX_LINES = 5;

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

export function Editor({
  theme,
  width,
  canSend,
  placeholder = "Type a message or / for commands...",
  onSubmit,
  onExternalEditor,
  onAtComplete,
  onRegisterEditor,
  onValueChange,
  onHelpRequest,
  onSendBlocked,
  disabled = false,
}: EditorProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  valueRef.current = value;
  cursorRef.current = cursor;

  const setValueAndCursor = useCallback((v: string, c: number) => {
    valueRef.current = v;
    cursorRef.current = c;
    setValue(v);
    setCursor(c);
    onValueChange?.(v);
  }, [onValueChange]);

  useEffect(() => {
    onRegisterEditor?.((text: string) => setValueAndCursor(valueRef.current + text, valueRef.current.length + text.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterEditor]);

  useInput((input, key) => {
    if (disabled) return;
    // 同步检查：App 的全局处理器先于本组件执行并同步更新 store，
    // 同一按键事件里打开对话框后，这里必须立刻让位。
    const snap = getStore().getSnapshot();
    if (Object.values(snap.dialogs).some(Boolean) || snap.approval !== null || getQuestionQueue()?.getSnapshot()) {
      return;
    }
    const v = valueRef.current;
    const c = cursorRef.current;

    // Enter：发送 / 行尾 `\` 时换行（必须先于可打印字符分支：Ink 7 中 Enter 的 input 是 "\r"）
    if (key.return) {
      if (v.endsWith("\\")) {
        setValueAndCursor(v.slice(0, -1) + "\n", v.length);
        return;
      }
      if (v.trim() === "") return;
      if (!canSend) {
        onSendBlocked?.();
        return;
      }
      const text = v;
      setValueAndCursor("", 0);
      onSubmit(text);
      return;
    }

    // 空输入时 "?" 打开帮助（opencode：textarea 未聚焦时 ? 显示帮助）
    if (input === "?" && v === "") {
      onHelpRequest?.();
      return;
    }

    // 粘贴 / 普通字符
    if (input.length > 0 && !key.ctrl && !key.meta && !key.shift) {
      setValueAndCursor(v.slice(0, c) + input + v.slice(c), c + input.length);
      return;
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor(Math.min(v.length, c + 1));
      return;
    }
    if (key.upArrow) {
      const lineStart = v.lastIndexOf("\n", c - 1) + 1;
      if (lineStart > 0) {
        const col = c - lineStart;
        const prevStart = v.lastIndexOf("\n", lineStart - 2) + 1;
        setCursor(Math.min(prevStart + col, lineStart - 1));
      } else {
        setCursor(0);
      }
      return;
    }
    if (key.downArrow) {
      const lineEnd = v.indexOf("\n", c);
      if (lineEnd >= 0) {
        const lineStart = v.lastIndexOf("\n", c - 1) + 1;
        const col = c - lineStart;
        const nextEnd = v.indexOf("\n", lineEnd + 1);
        const nextLineEnd = nextEnd === -1 ? v.length : nextEnd;
        setCursor(Math.min(lineEnd + 1 + col, nextLineEnd));
      } else {
        setCursor(v.length);
      }
      return;
    }
    if (key.backspace) {
      if (c > 0) {
        const before = v.slice(0, c - 1);
        const after = v.slice(c);
        setValueAndCursor(before + after, c - 1);
      }
      return;
    }
    if (key.delete) {
      if (c < v.length) {
        setValueAndCursor(v.slice(0, c) + v.slice(c + 1), c);
      }
      return;
    }
    if (key.ctrl && input === "a") {
      const lineStart = v.lastIndexOf("\n", c - 1) + 1;
      setCursor(lineStart);
      return;
    }
    if (key.ctrl && input === "e") {
      // ctrl+e → 外部编辑器（opencode 同款；编辑完直接发送）
      onExternalEditor(v, (nv) => {
        setValueAndCursor("", 0);
        if (nv.trim() !== "" && canSend) onSubmit(nv);
      });
      return;
    }
    if (key.ctrl && input === "k") {
      const lineEnd = v.indexOf("\n", c);
      const cutEnd = lineEnd === -1 ? v.length : lineEnd;
      setValueAndCursor(v.slice(0, c) + v.slice(cutEnd), c);
      return;
    }
    if (key.ctrl && input === "w") {
      // 杀到上一个词首
      let start = c;
      while (start > 0 && /\s/.test(v[start - 1]!)) start--;
      while (start > 0 && !/\s/.test(v[start - 1]!)) start--;
      setValueAndCursor(v.slice(0, start) + v.slice(c), start);
      return;
    }
    if (key.tab) {
      // Tab → 两空格（简化）
      setValueAndCursor(v.slice(0, c) + "  " + v.slice(c), c + 2);
      return;
    }
  });

  // 可视区域：光标所在行窗口
  const lines = value.split("\n");
  const cursorLine = value.slice(0, cursor).split("\n").length - 1;
  const windowStart = Math.max(0, Math.min(cursorLine - MAX_LINES + 1, Math.max(0, lines.length - MAX_LINES)));
  const visibleLines = lines.slice(windowStart, windowStart + MAX_LINES);

  // 渲染每行 + 光标
  const renderLine = (lineText: string, lineIndexInView: number): React.ReactElement => {
    const globalLine = windowStart + lineIndexInView;
    const lineStartOffset = lines.slice(0, globalLine).reduce((acc, l) => acc + l.length + 1, 0);
    let relCursor = cursor - lineStartOffset;
    if (globalLine !== cursorLine) relCursor = -1;
    if (relCursor < 0 || relCursor > lineText.length) {
      return <Text key={globalLine}>{lineText || " "}</Text>;
    }
    const before = lineText.slice(0, relCursor);
    const at = lineText.slice(relCursor, relCursor + 1) || " ";
    const after = lineText.slice(relCursor + 1);
    return (
      <Text key={globalLine}>
        {before}
        <Text backgroundColor={theme.text} color={theme.background} bold={true}>
          {at}
        </Text>
        {after}
      </Text>
    );
  };

  const empty = value === "";
  return (
    <Box flexDirection="row" width={width} paddingLeft={1}>
      <Text bold={true} color={theme.primary}>
        {">"}
      </Text>
      <Text> </Text>
      <Box flexDirection="column" width={Math.max(10, width - 3)}>
        {visibleLines.map((line, i) =>
          empty && i === 0 ? (
            <Text key={i} color={theme.textMuted} dimColor={true}>
              {placeholder}
            </Text>
          ) : (
            renderLine(line, i)
          ),
        )}
      </Box>
    </Box>
  );
}
