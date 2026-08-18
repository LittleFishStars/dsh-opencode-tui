import { WHALE_GLYPH } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
// DeepSeek 品牌蓝（--dsw-static-deepseek-500 / -400）
const brand = "\x1b[38;2;65;118;230m"
const brandBright = "\x1b[38;2;103;158;254m"

function wordmark(pad = "") {
  return WHALE_GLYPH.map((line) => `${pad}${brand}${line}${reset}`)
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${brandBright}${bold}DeepSeek Harness${reset}`,
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}dsh --profile dsh-opencode-tui -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
