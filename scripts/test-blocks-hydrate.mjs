// 单元验证：hydrate 后每块独立 start/end（思考时长不被整轮拉长）
import { projectEvents, viewsToLegacyMessages } from "../lib/projection.js";

// 时间序列：思考1 [t0,t1] 输出1 [t1,t2] 工具 [t2,t3] 思考2 [t3,t4] 输出2 [t4,t5] turn/end [t6]
const [t0, t1, t2, t3, t4, t5, t6] = [1000, 2000, 3000, 4000, 5000, 6000, 9000];
const events = [
  { type: "turn/start", seq: 1, time: t0, data: {} },
  { type: "assistant/chunk", seq: 2, time: t0, data: { step: 1, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } },
  { type: "assistant/chunk", seq: 3, time: t0, data: { step: 1, chunk: { type: "reasoning-delta", index: 0, text: "First thinking" } } },
  { type: "assistant/chunk", seq: 4, time: t1, data: { step: 1, chunk: { type: "block-end", index: 0, block: { type: "reasoning" } } } },
  { type: "assistant/chunk", seq: 5, time: t1, data: { step: 1, chunk: { type: "block-start", index: 1, blockType: "text" } } },
  { type: "assistant/chunk", seq: 6, time: t1, data: { step: 1, chunk: { type: "text-delta", index: 1, text: "First output" } } },
  { type: "assistant/chunk", seq: 7, time: t2, data: { step: 1, chunk: { type: "block-end", index: 1, block: { type: "text" } } } },
  { type: "tool/call", seq: 8, time: t2, data: { callId: "call_00_abc", name: "bash", arguments: '{"command":"echo hi"}' } },
  { type: "tool/result", seq: 9, time: t3, data: { message: { content: [{ callId: "call_00_abc" }, { type: "text", text: "hi" }] } } },
  { type: "assistant/chunk", seq: 10, time: t3, data: { step: 2, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } },
  { type: "assistant/chunk", seq: 11, time: t3, data: { step: 2, chunk: { type: "reasoning-delta", index: 0, text: "Second thinking" } } },
  { type: "assistant/chunk", seq: 12, time: t4, data: { step: 2, chunk: { type: "block-end", index: 0, block: { type: "reasoning" } } } },
  { type: "assistant/chunk", seq: 13, time: t4, data: { step: 2, chunk: { type: "block-start", index: 1, blockType: "text" } } },
  { type: "assistant/chunk", seq: 14, time: t4, data: { step: 2, chunk: { type: "text-delta", index: 1, text: "Second output" } } },
  { type: "assistant/chunk", seq: 15, time: t5, data: { step: 2, chunk: { type: "block-end", index: 1, block: { type: "text" } } } },
  { type: "assistant/message", seq: 16, time: t5, data: { message: { role: "assistant", content: [{ type: "text", text: "First outputSecond output" }], source: { provider: "p", model: "m" } } } },
  { type: "turn/end", seq: 17, time: t6, data: { reason: { kind: "completed" } } },
];
const views = projectEvents(events);
const msgs = viewsToLegacyMessages("ses_h", views, undefined, "workspace-write");
const parts = msgs.flatMap((m) => m.parts.filter((p) => p.type === "reasoning"));
console.log("reasoning parts:");
for (const p of parts) console.log(`  ${p.text}: ${p.time.end - p.time.start}ms (start=${p.time.start} end=${p.time.end})`);
// 思考1: [t0, t1] = 1000ms（不被整轮 t0→t6 拉长）；思考2: [t3, t4] = 1000ms
const ok = parts.length === 2
  && parts[0].text === "First thinking" && parts[0].time.start === t0 && parts[0].time.end === t1
  && parts[1].text === "Second thinking" && parts[1].time.start === t3 && parts[1].time.end === t4;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
