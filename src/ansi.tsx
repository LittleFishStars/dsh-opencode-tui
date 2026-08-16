/**
 * ANSI 文本渲染组件：把任意含 ANSI 转义的内容渲染成 Ink 元素。
 * 用于工具输出（bash 彩色输出等）。
 */
import React from "react";
import { Text } from "ink";
import { parseAnsi, type AnsiColor } from "./util.js";

/** ANSI 颜色 → Ink 颜色名。 */
const INK_COLORS: Record<AnsiColor, string> = {
  black: "black",
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
  magenta: "magenta",
  cyan: "cyan",
  white: "white",
  brightBlack: "blackBright",
  brightRed: "redBright",
  brightGreen: "greenBright",
  brightYellow: "yellowBright",
  brightBlue: "blueBright",
  brightMagenta: "magentaBright",
  brightCyan: "cyanBright",
  brightWhite: "whiteBright",
  default: "",
};

export interface AnsiTextProps {
  text: string;
  /** 若为 true 且文本不含 ANSI，则整段作为普通文本渲染（性能路径） */
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * 把含 ANSI 的文本渲染为带样式的行内内容。
 * 注意：本组件不换行 —— 外层负责按宽度换行（Ink Text 自动换行）。
 */
export function AnsiInline({ text, color, backgroundColor, bold, dim }: AnsiTextProps): React.ReactElement {
  if (!text.includes("\x1b")) {
    return (
      <Text color={color} backgroundColor={backgroundColor} bold={bold} dimColor={dim}>
        {text}
      </Text>
    );
  }
  const segments = parseAnsi(text);
  if (segments.length === 0) return <Text />;
  return (
    <Text color={color} backgroundColor={backgroundColor} bold={bold} dimColor={dim}>
      {segments.map((seg, i) => (
        <Text
          key={i}
          color={seg.fg && seg.fg !== "default" ? INK_COLORS[seg.fg] : color}
          backgroundColor={seg.bg && seg.bg !== "default" ? INK_COLORS[seg.bg] : backgroundColor}
          bold={seg.bold}
          dimColor={seg.dim}
          italic={seg.italic}
          underline={seg.underline}
          strikethrough={seg.strike}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * 多行 ANSI 文本（含换行），逐行渲染，保持样式。
 */
export function AnsiBlock({ text, color, backgroundColor }: AnsiTextProps): React.ReactElement {
  const lines = text.split("\n");
  return (
    <Text color={color} backgroundColor={backgroundColor}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          <AnsiInline text={line} color={color} backgroundColor={backgroundColor} />
          {i < lines.length - 1 ? "\n" : null}
        </React.Fragment>
      ))}
    </Text>
  );
}
