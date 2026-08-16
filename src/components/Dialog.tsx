/**
 * 对话框（opencode 风格居中覆盖层）：
 * - Dialog 外壳：绝对定位 + flex 居中
 * - ListDialog：j/k 导航 + 过滤输入（sessions / commands / models / themes）
 * - ConfirmDialog：确认框（quit / approval）
 * - HelpDialog：键位帮助
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "../theme.js";
import type { KeyBinding } from "../keys.js";
import { truncate, widthOf } from "../util.js";
import { getStore } from "../store.js";
import type { MouseEventData } from "../mouse.js";

export interface DialogItem {
  id: string;
  title: string;
  subtitle?: string;
  /** 图标字符（可选） */
  icon?: string;
}

/** 对话框尺寸（屏幕宽高 → 对话框宽高）。 */
export function dialogSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.min(width - 6, 60), height: Math.min(height - 4, 24) };
}

/** 对话框外壳：全屏覆盖层 + 居中 + 深灰背景 + 矩形上报（鼠标命中用）。 */
export function Dialog({
  theme,
  width,
  height,
  title,
  children,
}: {
  theme: Theme;
  width: number;
  height: number;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  const size = dialogSize(width, height);
  const left = Math.floor((width - size.width) / 2);
  const top = Math.floor((height - size.height) / 2);
  useEffect(() => {
    const store = getStore();
    store.setDialogRect({ left, top, width: size.width, height: size.height });
    return () => store.setDialogRect(null);
  }, [left, top, size.width, size.height]);
  return (
    <Box position="absolute" top={top} left={left} width={size.width} height={size.height} flexDirection="column">
      <Box
        width={size.width}
        height={size.height}
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.borderFocused}
        backgroundColor={theme.dialogBg}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text bold={true} color={theme.primary} backgroundColor={theme.dialogBg}>
          {title}
        </Text>
        <Box height={1} />
        {children}
      </Box>
    </Box>
  );
}

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

export function ListDialog({
  theme,
  width,
  height,
  title,
  items,
  filterable = true,
  onConfirm,
  onClose,
  emptyText = "No items",
  onRegisterMouse,
}: ListDialogProps): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === "") return items;
    return items.filter(
      (i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q),
    );
  }, [items, filter]);

  useEffect(() => {
    if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1));
  }, [filtered.length, selected]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || (key.ctrl === false && input === "k")) {
      setSelected((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow || (key.ctrl === false && input === "j")) {
      setSelected((prev) => Math.min(filtered.length - 1, prev + 1));
      return;
    }
    if (key.return) {
      const item = filtered[selectedRef.current];
      if (item) onConfirm(item);
      return;
    }
    if (filterable) {
      if (key.backspace) {
        setFilter((prev) => prev.slice(0, -1));
        return;
      }
      if (key.ctrl === false && input.length > 0) {
        setFilter((prev) => prev + input);
        return;
      }
    }
  });

  const visible = filtered.slice(0, Math.max(1, height - 8));
  const listHeight = Math.max(1, height - 8);

  // 鼠标：点击条目选中（双击确认），滚轮移动选择
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const lastClickRef = useRef<{ row: number; at: number } | null>(null);
  useEffect(() => {
    if (!onRegisterMouse) return;
    return onRegisterMouse((e: MouseEventData) => {
      if (e.type === "wheel") {
        setSelected((prev) => {
          const next = e.dx > 0 ? prev + 3 : prev - 3;
          return Math.max(0, Math.min(visibleRef.current.length - 1, next));
        });
        return true;
      }
      if (e.type === "mousedown" && e.button === 0) {
        const size = dialogSize(width, height);
        const left = Math.floor((width - size.width) / 2);
        const top = Math.floor((height - size.height) / 2);
        const innerX = e.x - left;
        const innerY = e.y - top;
        if (innerX < 1 || innerX >= size.width - 1) return false;
        const listStart = filterable ? 3 : 2; // title + spacer (+ filter)
        const row = innerY - listStart;
        if (row < 0 || row >= visibleRef.current.length) return true;
        const now = Date.now();
        const last = lastClickRef.current;
        const isDouble = last !== null && last.row === row && now - last.at < 1000;
        lastClickRef.current = { row, at: now };
        setSelected(row);
        if (isDouble) {
          const item = visibleRef.current[row];
          if (item) onConfirmRef.current(item);
        }
        return true;
      }
      return false;
    });
  }, [onRegisterMouse, filterable, width, height]);

  return (
    <Dialog theme={theme} width={width} height={height} title={title}>
      {filterable ? (
        <Box flexDirection="row" marginBottom={1}>
          <Text color={theme.textMuted}>/ </Text>
          <Text color={theme.text}>{filter || <Text color={theme.textMuted} dimColor={true}>filter...</Text>}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" height={listHeight}>
        {visible.length === 0 ? (
          <Text color={theme.textMuted}>{emptyText}</Text>
        ) : (
          visible.map((item, i) => (
            <Box key={item.id} flexDirection="row">
              <Text color={i === selectedRef.current ? theme.primary : theme.textMuted}>
                {i === selectedRef.current ? "› " : "  "}
              </Text>
              <Text color={i === selectedRef.current ? theme.text : theme.textMuted} bold={i === selectedRef.current}>
                {item.icon ? `${item.icon} ` : ""}
                {truncate(item.title, Math.max(10, width - 16))}
              </Text>
              {item.subtitle ? (
                <Text color={theme.textMuted} dimColor={true}>
                  {"  "}
                  {truncate(item.subtitle, Math.max(5, width - 40))}
                </Text>
              ) : null}
            </Box>
          ))
        )}
      </Box>
      <Box height={1} />
      <Text color={theme.textMuted} dimColor={true}>
        ↑/↓ or k/j navigate · enter select · esc close
      </Text>
    </Dialog>
  );
}

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

export function ConfirmDialog({
  theme,
  width,
  height,
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const [yes, setYes] = useState(true);
  useInput((_input, key) => {
    if (key.escape || key.leftArrow || key.rightArrow) {
      setYes((prev) => !prev);
      return;
    }
    if (key.return) {
      if (yes) onConfirm();
      else onCancel();
      return;
    }
    if (key.tab) {
      setYes((prev) => !prev);
    }
  });
  return (
    <Dialog theme={theme} width={width} height={height} title={title}>
      <Text color={theme.text} wrap="wrap">
        {message}
      </Text>
      <Box height={1} />
      <Box flexDirection="row">
        <Text color={yes ? theme.background : theme.textMuted} backgroundColor={yes ? theme.primary : undefined} bold={yes}>
          {yes ? ` [${confirmLabel}] ` : ` ${confirmLabel} `}
        </Text>
        <Text> </Text>
        <Text color={!yes ? theme.background : theme.textMuted} backgroundColor={!yes ? theme.textMuted : undefined} bold={!yes}>
          {!yes ? ` [${cancelLabel}] ` : ` ${cancelLabel} `}
        </Text>
      </Box>
    </Dialog>
  );
}

export function HelpDialog({
  theme,
  width,
  height,
  sections,
}: {
  theme: Theme;
  width: number;
  height: number;
  sections: Array<{ title: string; bindings: KeyBinding[] }>;
}): React.ReactElement {
  const rows: Array<{ key: string; help: string; description: string; section: string }> = [];
  for (const section of sections) {
    for (const binding of section.bindings) {
      rows.push({ key: binding.keys[0]!, help: binding.help, description: binding.description, section: section.title });
    }
  }
  const visible = rows.slice(0, Math.max(1, height - 10));
  return (
    <Dialog theme={theme} width={width} height={height} title="Help">
      <Box flexDirection="column">
        {visible.map((row, i) => (
          <Box key={i} flexDirection="row">
            <Box width={10}>
              <Text color={theme.textMuted}>{row.section}</Text>
            </Box>
            <Box width={12}>
              <Text color={theme.primary} bold={true}>{row.help}</Text>
            </Box>
            <Text color={theme.text}>{row.description}</Text>
          </Box>
        ))}
      </Box>
      <Box height={1} />
      <Text color={theme.textMuted} dimColor={true}>
        esc to close
      </Text>
    </Dialog>
  );
}
