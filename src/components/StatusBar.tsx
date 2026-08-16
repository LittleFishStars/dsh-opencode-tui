/**
 * 底部状态栏（opencode 风格）：
 * [ctrl+? help] [通知/空白] [模型 · 会话信息]
 */
import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import type { Notification } from "../store.js";
import { truncate } from "../util.js";

export interface StatusBarProps {
  theme: Theme;
  width: number;
  notification: Notification | null;
  model: { provider: string; model: string } | null;
  sessionLabel: string | null;
  busy: boolean;
}

export function StatusBar({ theme, width, notification, model, sessionLabel, busy }: StatusBarProps): React.ReactElement {
  const helpWidget = (
    <Text backgroundColor={theme.textMuted} color={theme.backgroundDarker} bold={true}>
      {" ctrl+? help "}
    </Text>
  );

  const middleWidth = Math.max(0, width - 24);
  let middle: React.ReactElement;
  if (notification) {
    const bg =
      notification.type === "error" ? theme.error : notification.type === "warn" ? theme.warning : theme.info;
    middle = (
      <Text backgroundColor={bg} color={theme.background} bold={true}>
        {` ${truncate(notification.message, Math.max(5, middleWidth - 2))} `}
      </Text>
    );
  } else {
    middle = (
      <Text backgroundColor={theme.backgroundSecondary} color={theme.text}>
        {" "}
      </Text>
    );
  }

  const rightText = [
    model ? `${model.provider}/${model.model}` : null,
    sessionLabel,
    busy ? "working..." : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");
  const right = (
    <Text backgroundColor={theme.backgroundDarker} color={theme.text} dimColor={true}>
      {` ${truncate(rightText, Math.max(5, middleWidth - 2))} `}
    </Text>
  );

  return (
    <Box flexDirection="row" width={width} height={1}>
      {helpWidget}
      <Box width={Math.max(0, width - 22)}>{middle}</Box>
      {right}
    </Box>
  );
}
