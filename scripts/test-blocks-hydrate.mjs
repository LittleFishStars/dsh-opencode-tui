// 单元验证：hydrate 路径含工具卡
// projection 按 step 生成独立 assistant 卡片（工具轮后的新回复是新卡片）：
//   卡片1：思考1→输出1 + 工具卡（挂到 currentAssistant）
//   卡片2：思考2→输出2
// 每个卡片内 part 顺序 = 内容顺序（id 递增序）
import { projectEvents, viewsToLegacyMessages } from "../lib/projection.js";

const t = Date.now();
const events = [
  { type: "turn/start", seq: 1, time: t, data: {} },
  { type: "assistant/chunk", seq: 2, time: t, data: { step: 1, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } },
  { type: "assistant/chunk", seq: 3, time: t, data: { step: 1, chunk: { type: "reasoning-delta", index: 0, text: "First thinking" } } },
  { type: "assistant/chunk", seq: 4, time: t, data: { step: 1, chunk: { type: "block-end", index: 0, block: { type: "reasoning" } } } },
  { type: "assistant/chunk", seq: 5, time: t, data: { step: 1, chunk: { type: "block-start", index: 1, blockType: "text" } } },
  { type: "assistant/chunk", seq: 6, time: t, data: { step: 1, chunk: { type: "text-delta", index: 1, text: "First output" } } },
  { type: "assistant/chunk", seq: 7, time: t, data: { step: 1, chunk: { type: "block-end", index: 1, block: { type: "text" } } } },
  { type: "tool/call", seq: 8, time: t, data: { callId: "call_00_abc", name: "bash", arguments: '{"command":"echo hi"}' } },
  { type: "tool/result", seq: 9, time: t, data: { message: { content: [{ callId: "call_00_abc" }, { type: "text", text: "hi" }] } } },
  { type: "assistant/chunk", seq: 10, time: t, data: { step: 2, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } },
  { type: "assistant/chunk", seq: 11, time: t, data: { step: 2, chunk: { type: "reasoning-delta", index: 0, text: "Second thinking" } } },
  { type: "assistant/chunk", seq: 12, time: t, data: { step: 2, chunk: { type: "block-end", index: 0, block: { type: "reasoning" } } } },
  { type: "assistant/chunk", seq: 13, time: t, data: { step: 2, chunk: { type: "block-start", index: 1, blockType: "text" } } },
  { type: "assistant/chunk", seq: 14, time: t, data: { step: 2, chunk: { type: "text-delta", index: 1, text: "Second output" } } },
  { type: "assistant/chunk", seq: 15, time: t, data: { step: 2, chunk: { type: "block-end", index: 1, block: { type: "text" } } } },
  { type: "assistant/message", seq: 16, time: t, data: { message: { role: "assistant", content: [{ type: "text", text: "First outputSecond output" }], source: { provider: "p", model: "m" } } } },
  { type: "turn/end", seq: 17, time: t, data: { reason: { kind: "completed" } } },
];
const views = projectEvents(events);
const msgs = viewsToLegacyMessages("ses_h", views, undefined, "workspace-write");
console.log("assistant cards:", msgs.length);
const allParts = msgs.flatMap((m) => m.parts.map((p) => (p.type === "tool" ? `tool:${p.tool}` : `${p.type}:${p.text}`)));
console.log("parts (按卡顺序):", allParts);
// 卡片1: 思考1→输出1→工具卡；卡片2: 思考2→输出2
const expected = [
  "reasoning:First thinking", "text:First output", "tool:bash",
  "reasoning:Second thinking", "text:Second output",
];
const ok = msgs.length === 2 && allParts.every((s, i) => s === expected[i]);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
