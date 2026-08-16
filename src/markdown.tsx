/**
 * Markdown 渲染：marked token 树 → Ink 元素。
 * 支持标题/段落/粗斜体/行内与围栏代码(highlight.js 高亮)/引用/列表/表格/分隔线/链接。
 */
import React from "react";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import hljs from "highlight.js/lib/common";
import type { Theme } from "./theme.js";

marked.setOptions({
  gfm: true,
  breaks: false,
});

/** 行内样式片段。 */
interface InlineSeg {
  text: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

function hljsColor(cls: string, theme: Theme): string | undefined {
  switch (cls) {
    case "hljs-comment":
    case "hljs-quote":
      return theme.synComment;
    case "hljs-keyword":
    case "hljs-selector-tag":
    case "hljs-literal":
    case "hljs-doctag":
    case "hljs-meta":
      return theme.synKeyword;
    case "hljs-title":
    case "hljs-title-function":
    case "hljs-section":
    case "hljs-function":
    case "hljs-name":
      return theme.synFunction;
    case "hljs-variable":
    case "hljs-template-variable":
    case "hljs-attr":
    case "hljs-attribute":
      return theme.synVariable;
    case "hljs-string":
    case "hljs-regexp":
    case "hljs-addition":
    case "hljs-char":
    case "hljs-symbol":
      return theme.synString;
    case "hljs-number":
    case "hljs-bullet":
    case "hljs-link":
      return theme.synNumber;
    case "hljs-type":
    case "hljs-built_in":
    case "hljs-selector-attr":
    case "hljs-selector-pseudo":
    case "hljs-class":
    case "hljs-title-class":
      return theme.synType;
    case "hljs-operator":
    case "hljs-params":
      return theme.synOperator;
    default:
      return undefined;
  }
}

/** 高亮代码 → 带颜色的行片段。 */
function highlightCode(code: string, lang: string | undefined, theme: Theme): Array<{ text: string; color?: string }> {
  let html: string;
  try {
    if (lang && hljs.getLanguage(lang)) {
      html = hljs.highlight(code, { language: lang }).value;
    } else {
      html = hljs.highlightAuto(code, ["bash", "javascript", "typescript", "json", "python", "yaml", "markdown", "html", "css", "go", "rust", "sql", "diff", "java", "c", "cpp"]).value;
    }
  } catch {
    html = escapeHtml(code);
  }
  // 解析 hljs 输出：<span class="hljs-x">…</span>（无嵌套，纯文本）
  const segments: Array<{ text: string; color?: string }> = [];
  const regex = /<span class="([^"]+)">([\s\S]*?)<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (match[1] !== undefined) {
      const classes = match[1]!.split(/\s+/);
      let color: string | undefined;
      for (const cls of classes) {
        const c = hljsColor(cls, theme);
        if (c) {
          color = c;
          break;
        }
      }
      segments.push({ text: match[2]!, color });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3] });
    }
  }
  return segments;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 递归展开行内 token → 样式片段。 */
function inlineSegments(tokens: Token[], theme: Theme): InlineSeg[] {
  const out: InlineSeg[] = [];
  for (const token of tokens) {
    if (token.type === "text") {
      out.push({ text: token.text });
    } else if (token.type === "strong") {
      for (const seg of inlineSegments(token.tokens ?? [], theme)) out.push({ ...seg, bold: true });
    } else if (token.type === "em") {
      for (const seg of inlineSegments(token.tokens ?? [], theme)) out.push({ ...seg, italic: true });
    } else if (token.type === "del") {
      for (const seg of inlineSegments(token.tokens ?? [], theme)) out.push({ ...seg, strike: true });
    } else if (token.type === "codespan") {
      out.push({ text: token.text, color: theme.mdCode });
    } else if (token.type === "link") {
      for (const seg of inlineSegments(token.tokens ?? [], theme)) {
        out.push({ ...seg, color: theme.mdLinkText, underline: true });
      }
    } else if (token.type === "image") {
      out.push({ text: `[${token.text}]`, color: theme.mdLinkText });
    } else if (token.type === "br") {
      out.push({ text: "\n" });
    } else if (token.type === "escape") {
      out.push({ text: token.text });
    } else if (token.type === "html") {
      out.push({ text: token.text });
    } else if (token.type === "space") {
      out.push({ text: " " });
    } else if ("text" in token && typeof token.text === "string") {
      out.push({ text: token.text });
    }
  }
  return out;
}

/** 行内片段 → 单个 Text 元素（多行文本时按行拆分渲染）。 */
export function InlineText({ segs, color, wrap }: { segs: InlineSeg[]; color?: string; wrap?: boolean }): React.ReactElement {
  const nodes: React.ReactElement[] = [];
  let line: React.ReactElement[] = [];
  let key = 0;
  const flush = () => {
    if (line.length > 0) {
      nodes.push(
        <Text key={key++} color={color}>
          {line}
        </Text>,
      );
      line = [];
    }
  };
  for (const seg of segs) {
    const parts = seg.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        flush();
        line = [];
      }
      line.push(
        <Text
          key={`${key}-${i}`}
          color={seg.color ?? color}
          bold={seg.bold}
          italic={seg.italic}
          underline={seg.underline}
          strikethrough={seg.strike}
        >
          {part}
        </Text>,
      );
    });
  }
  flush();
  if (wrap === false) {
    return <Text color={color}>{nodes}</Text>;
  }
  return (
    <Text color={color} wrap="wrap">
      {nodes}
    </Text>
  );
}

/** 代码块组件（带语法高亮）。 */
export function CodeBlock({ code, lang, theme }: { code: string; lang?: string; theme: Theme }): React.ReactElement {
  const segments = highlightCode(code, lang, theme);
  const lines = splitByNewline(segments);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.borderDim}
      
      paddingLeft={1}
      paddingRight={1}
      marginTop={0}
    >
      {lines.map((lineSegs, i) => (
        <Text key={i}>
          {lineSegs.length === 0
            ? " "
            : lineSegs.map((seg, j) => (
                <Text key={j} color={seg.color}>
                  {seg.text}
                </Text>
              ))}
        </Text>
      ))}
    </Box>
  );
}

function splitByNewline(segments: Array<{ text: string; color?: string }>): Array<Array<{ text: string; color?: string }>> {
  const lines: Array<Array<{ text: string; color?: string }>> = [[]];
  for (const seg of segments) {
    const parts = seg.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1]!.push({ text: part, color: seg.color });
    });
  }
  return lines;
}

/** 一个 markdown 文档 → Ink 块元素列表（不包含包裹 Box）。 */
export function renderMarkdownBlocks(md: string, theme: Theme): React.ReactElement[] {
  const tokens = marked.lexer(md, { gfm: true });
  const blocks: React.ReactElement[] = [];
  let key = 0;
  const inline = (toks: Token[]): React.ReactElement => {
    const segs = inlineSegments(toks, theme);
    return <InlineText key={key++} segs={segs} />;
  };

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const level = token.depth;
        const segs = inlineSegments(token.tokens ?? [], theme);
        const marker = level === 1 ? "█ " : level === 2 ? "▊ " : level === 3 ? "▎ " : "";
        blocks.push(
          <Text key={key++} bold={level <= 2} color={theme.mdHeading}>
            {marker}
            <InlineText segs={segs} color={theme.mdHeading} />
          </Text>,
        );
        break;
      }
      case "paragraph":
        blocks.push(<Text key={key++}>{inline(token.tokens ?? [])}</Text>);
        break;
      case "code":
        blocks.push(<CodeBlock key={key++} code={token.text} lang={token.lang ?? undefined} theme={theme} />);
        break;
      case "blockquote": {
        const inner = renderMarkdownBlocks(token.text, theme);
        blocks.push(
          <Box key={key++} flexDirection="column" borderLeft={true} borderColor={theme.mdBlockQuote} paddingLeft={1} marginLeft={0}>
            {inner.map((b, i) => (
              <React.Fragment key={i}>{b}</React.Fragment>
            ))}
          </Box>,
        );
        break;
      }
      case "list": {
        const ordered = token.ordered;
        let index = token.start ?? 1;
        blocks.push(
          <Box key={key++} flexDirection="column">
            {token.items.map((item: Tokens.ListItem, i: number) => {
              const marker = ordered ? `${index++}.` : "•";
              const itemBody = item.tokens ? inline(item.tokens) : <Text>{item.text}</Text>;
              return (
                <Box key={i} flexDirection="row">
                  <Text color={theme.mdListItem}>{marker} </Text>
                  <Box flexDirection="column" flexShrink={1}>
                    {itemBody}
                    {item.tokens?.some((t: Token) => t.type === "list") ? (
                      <Box marginLeft={2}>
                        {renderMarkdownBlocks(
                          item.tokens
                            .filter((t: Token) => t.type === "list")
                            .map((t: Token) => (t as Tokens.List).raw)
                            .join("\n"),
                          theme,
                        ).map((b, j) => (
                          <React.Fragment key={j}>{b}</React.Fragment>
                        ))}
                      </Box>
                    ) : null}
                  </Box>
                </Box>
              );
            })}
          </Box>,
        );
        break;
      }
      case "hr":
        blocks.push(<Text key={key++} color={theme.mdHr}>{"─".repeat(40)}</Text>);
        break;
      case "table": {
        const header = token.header;
        const rows = token.rows;
        blocks.push(
          <Box key={key++} flexDirection="column">
            <Text bold color={theme.mdHeading}>
              {header.join(" | ")}
            </Text>
            {rows.map((row: string[], i: number) => (
              <Text key={i}>{row.join(" | ")}</Text>
            ))}
          </Box>,
        );
        break;
      }
      case "space":
        break;
      default:
        if ("text" in token && typeof token.text === "string" && token.text.trim() !== "") {
          blocks.push(<Text key={key++}>{token.text}</Text>);
        }
    }
  }
  return blocks;
}

/** 把 markdown 渲染为一列块（消息正文用）。 */
export function Markdown({ md, theme, width }: { md: string; theme: Theme; width?: number }): React.ReactElement {
  if (md.trim() === "") {
    return <Text> </Text>;
  }
  const blocks = renderMarkdownBlocks(md, theme);
  return (
    <Box flexDirection="column" width={width} flexShrink={1}>
      {blocks.map((block, i) => (
        <React.Fragment key={i}>{block}</React.Fragment>
      ))}
    </Box>
  );
}
