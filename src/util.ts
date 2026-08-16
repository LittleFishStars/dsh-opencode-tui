/**
 * 通用工具：终端宽度、ANSI 解析、换行估算。
 */
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

/** 渲染宽度（含 CJK 双宽）。 */
export function widthOf(text: string): number {
  return stringWidth(text);
}

/**
 * 把一段文本按宽度折行（终端语义），返回每一行。
 * 用于估算消息渲染高度（与 Ink 的 Text 换行基本一致）。
 */
export function wrapLines(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const wrapped = wrapAnsi(text, width, {
    hard: true,
    trim: false,
    wordWrap: true,
  });
  const lines = wrapped.split("\n");
  // 空文本 → 一行空行
  return lines.length === 0 ? [""] : lines;
}

/** 估算一段文本渲染成 terminal 行所需的行数（按给定宽度）。 */
export function estimateLines(text: string, width: number): number {
  if (text === "") return 1;
  return wrapLines(text, width).length;
}

/** 计算若干段文本（各自独立折行）的总行数。 */
export function totalLines(parts: string[], width: number): number {
  let n = 0;
  for (const p of parts) n += estimateLines(p, width);
  return n;
}

/** 截断字符串到渲染宽度，加省略号。 */
export function truncate(text: string, maxWidth: number, ellipsis = "..."): string {
  if (widthOf(text) <= maxWidth) return text;
  let out = "";
  let w = 0;
  const budget = Math.max(0, maxWidth - widthOf(ellipsis));
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}

/** ANSI 颜色语义 → 我们的 16 色映射（用于工具输出等任意 ANSI 文本）。 */
export type AnsiColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite"
  | "default";

export interface StyledSegment {
  text?: string;
  fg?: AnsiColor;
  bg?: AnsiColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  strike?: boolean;
}

function mapColor(color: string | undefined, bright: boolean): AnsiColor {
  if (color === undefined) return "default";
  if (bright) {
    switch (color) {
      case "black": return "brightBlack";
      case "red": return "brightRed";
      case "green": return "brightGreen";
      case "yellow": return "brightYellow";
      case "blue": return "brightBlue";
      case "magenta": return "brightMagenta";
      case "cyan": return "brightCyan";
      case "white": return "brightWhite";
    }
    return "default";
  }
  switch (color) {
    case "black": return "black";
    case "red": return "red";
    case "green": return "green";
    case "yellow": return "yellow";
    case "blue": return "blue";
    case "magenta": return "magenta";
    case "cyan": return "cyan";
    case "white": return "white";
  }
  return "default";
}

/**
 * 把任意 ANSI 文本解析成带样式的分段（供 Ink Text 渲染）。
 * 自实现 SGR 解析：\x1b[<params>m 序列；其余转义（OSC/链接等）剥离。
 */
export function parseAnsi(text: string): StyledSegment[] {
  if (!text.includes("\x1b")) {
    return text === "" ? [] : [{ text }];
  }
  const segments: StyledSegment[] = [];
  let style: StyledSegment = { text: "" };
  let plain = "";
  const flush = () => {
    if (plain !== "") {
      segments.push({ text: plain, ...style });
      plain = "";
    }
  };
  const sgrRegex = /\x1b\[([0-9;]*)m/g;
  // 通用转义剥离：CSI 非 m 结尾、OSC 到 BEL/ST
  const otherEscape = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z@`]/g;
  const parts: Array<{ text: string; sgr: string | null }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = sgrRegex.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), sgr: null });
    parts.push({ text: "", sgr: match[1] ?? "" });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), sgr: null });
  for (const part of parts) {
    if (part.sgr === null) {
      plain += part.text.replace(otherEscape, "");
      continue;
    }
    flush();
    applySgr(part.sgr, style);
  }
  flush();
  return segments;
}

function applySgr(params: string, style: StyledSegment): void {
  const codes = params.split(";").map((c) => (c === "" ? 0 : Number.parseInt(c, 10)));
  let i = 0;
  while (i < codes.length) {
    const code = codes[i]!;
    switch (true) {
      case code === 0:
        style = { text: "" };
        break;
      case code === 1:
        style.bold = true;
        break;
      case code === 2:
        style.dim = true;
        break;
      case code === 3:
        style.italic = true;
        break;
      case code === 4:
        style.underline = true;
        break;
      case code === 9:
        style.strike = true;
        break;
      case code === 39:
        style.fg = undefined;
        break;
      case code === 49:
        style.bg = undefined;
        break;
      case code >= 30 && code <= 37:
        style.fg = mapColor(NAMED[code - 30]!, false);
        break;
      case code >= 90 && code <= 97:
        style.fg = mapColor(NAMED[code - 90]!, true);
        break;
      case code >= 40 && code <= 47:
        style.bg = mapColor(NAMED[code - 40]!, false);
        break;
      case code >= 100 && code <= 107:
        style.bg = mapColor(NAMED[code - 100]!, true);
        break;
      case code === 38 || code === 48: {
        // 扩展色：38;5;n 或 38;2;r;g;b
        const isFg = code === 38;
        const mode = codes[i + 1];
        if (mode === 5 && codes[i + 2] !== undefined) {
          const color = approximate256(codes[i + 2]!);
          if (isFg) style.fg = color;
          else style.bg = color;
          i += 2;
        } else if (mode === 2 && codes[i + 2] !== undefined && codes[i + 3] !== undefined && codes[i + 4] !== undefined) {
          const color = rgbToClosest([codes[i + 2]!, codes[i + 3]!, codes[i + 4]!]);
          if (isFg) style.fg = color;
          else style.bg = color;
          i += 4;
        }
        break;
      }
    }
    i++;
  }
}

const NAMED = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

function approximate256(code: number): AnsiColor {
  if (code < 8) return NAMED[code] ?? "default";
  if (code < 16) return mapColor(NAMED[code - 8]!, true);
  if (code < 232) {
    const cube = code - 16;
    const r = Math.round(((cube / 36) % 6) * 51);
    const g = Math.round(((cube / 6) % 6) * 51);
    const b = Math.round((cube % 6) * 51);
    return rgbToClosest([r, g, b]);
  }
  const gray = 8 + (code - 232) * 10;
  return rgbToClosest([gray, gray, gray]);
}

/** RGB → 最接近的 16 色（终端降级用）。 */
function rgbToClosest([r, g, b]: [number, number, number]): AnsiColor {
  const named: Array<[AnsiColor, [number, number, number]]> = [
    ["black", [0, 0, 0]],
    ["red", [170, 0, 0]],
    ["green", [0, 170, 0]],
    ["yellow", [170, 85, 0]],
    ["blue", [0, 0, 170]],
    ["magenta", [170, 0, 170]],
    ["cyan", [0, 170, 170]],
    ["white", [170, 170, 170]],
    ["brightBlack", [85, 85, 85]],
    ["brightRed", [255, 85, 85]],
    ["brightGreen", [85, 255, 85]],
    ["brightYellow", [255, 255, 85]],
    ["brightBlue", [85, 85, 255]],
    ["brightMagenta", [255, 85, 255]],
    ["brightCyan", [85, 255, 255]],
    ["brightWhite", [255, 255, 255]],
  ];
  let best: AnsiColor = "white";
  let bestDist = Infinity;
  for (const [name, [cr, cg, cb]] of named) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

/** 去掉 ANSI 后的纯文本。 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "");
}

/** 从富文本（可含 ANSI）提取纯文本。 */
export function plainText(text: string): string {
  return stripAnsi(text);
}

/** 时间差格式化（opencode 风格）：3ms / 4.2s / 1m30s。 */
export function formatDuration(startMs: number, endMs: number): string {
  const diff = Math.max(0, endMs - startMs);
  if (diff < 1000) return `${Math.round(diff)}ms`;
  if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`;
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.round((diff % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`;
}

/** 相对时间（会话列表用）：刚刚 / 3m / 2h / 3d。 */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** 会话标题兜底。 */
export function fallbackTitle(text: string, maxWords = 5, maxBytes = 40): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "New Session";
  const words = collapsed.split(" ").slice(0, maxWords).join(" ");
  let title = words;
  if (Buffer.byteLength(title, "utf8") > maxBytes) {
    title = Buffer.from(title, "utf8").subarray(0, maxBytes).toString("utf8").replace(/[\uD800-\uDBFF]$/, "");
  }
  return title;
}

/** 转圈帧序列。 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
