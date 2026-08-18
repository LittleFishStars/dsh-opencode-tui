import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { WHALE_GLYPH, WHALE_GLYPH_COLUMNS } from "../logo"

/** DeepSeek 品牌蓝（--dsw-static-deepseek-500）。 */
const DEEPSEEK_BRAND = RGBA.fromInts(65, 118, 230, 255)
/** 亮品牌蓝（--dsw-static-deepseek-400），用于标题强调。 */
const DEEPSEEK_BRAND_BRIGHT = RGBA.fromInts(103, 158, 254, 255)

export function Logo() {
  const { theme } = useTheme()

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char, index) => (
      <text key={index} fg={fg} attributes={attrs} selectable={false}>
        {char}
      </text>
    ))
  }

  return (
    <box flexDirection="row" gap={2}>
      <box flexDirection="column" width={WHALE_GLYPH_COLUMNS}>
        <text fg={DEEPSEEK_BRAND}>{" "}</text>
        <For each={WHALE_GLYPH}>
          {(line) => <text fg={DEEPSEEK_BRAND}>{line}</text>}
        </For>
      </box>
      <box flexDirection="column" justifyContent="center">
        <text fg={DEEPSEEK_BRAND_BRIGHT} attributes={TextAttributes.BOLD}>
          DeepSeek Harness
        </text>
        <text fg={theme.textMuted}>/help commands · Esc interrupt · Ctrl+C quit</text>
      </box>
    </box>
  )
}
