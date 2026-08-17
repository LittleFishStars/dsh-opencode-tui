// 单元验证：hydrate 路径（projection）两段思考 → 两个独立 reasoning part
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
const assistant = views.filter((v) => v.kind === "assistant");
console.log("assistant cards:", assistant.length);
const msgs = viewsToLegacyMessages("ses_h", assistant, undefined, "workspace-write");
const reasoning = msgs[0].parts.filter((p) => p.type === "reasoning");
console.log("reasoning parts:", reasoning.length);
for (const r of reasoning) console.log(" -", JSON.stringify({ text: r.text, hasEnd: r.time.end !== undefined }));
const ok = reasoning.length === 2
  && reasoning[0].text === "First thinking"
  && reasoning[1].text === "Second thinking"
  && reasoning[0].id !== reasoning[1].id
  && reasoning[0].time.end !== undefined && reasoning[1].time.end !== undefined;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
