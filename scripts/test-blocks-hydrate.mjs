// 单元验证：hydrate 路径 parts 顺序（思考1→输出1→思考2→输出2）
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
  { type: "assistant/chunk", seq: 8, time: t, data: { step: 2, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } },
  { type: "assistant/chunk", seq: 9, time: t, data: { step: 2, chunk: { type: "reasoning-delta", index: 0, text: "Second thinking" } } },
  { type: "assistant/chunk", seq: 10, time: t, data: { step: 2, chunk: { type: "block-end", index: 0, block: { type: "reasoning" } } } },
  { type: "assistant/chunk", seq: 11, time: t, data: { step: 2, chunk: { type: "block-start", index: 1, blockType: "text" } } },
  { type: "assistant/chunk", seq: 12, time: t, data: { step: 2, chunk: { type: "text-delta", index: 1, text: "Second output" } } },
  { type: "assistant/chunk", seq: 13, time: t, data: { step: 2, chunk: { type: "block-end", index: 1, block: { type: "text" } } } },
  { type: "assistant/message", seq: 14, time: t, data: { message: { role: "assistant", content: [{ type: "text", text: "First outputSecond output" }], source: { provider: "p", model: "m" } } } },
  { type: "turn/end", seq: 15, time: t, data: { reason: { kind: "completed" } } },
];
const views = projectEvents(events);
const msgs = viewsToLegacyMessages("ses_h", views.filter((v) => v.kind === "assistant"), undefined, "workspace-write");
// hydrate 时 TUI 按 part id 排序（session.sync 的 parts 合并后按数组序渲染，
// 但为一致这里也模拟 TUI 排序）
const sorted = [...msgs[0].parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const seq = sorted.map((p) => `${p.type}:${p.text}`);
console.log("parts (TUI 排序后):", seq);
const expected = ["reasoning:First thinking", "text:First output", "reasoning:Second thinking", "text:Second output"];
const ok = seq.length === 4 && seq.every((s, i) => s === expected[i]);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
