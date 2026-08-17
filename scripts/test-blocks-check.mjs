// 单元验证：两段思考+两段输出 → 顺序为 思考1→输出1→思考2→输出2
import { OcServer } from "../lib/oc-server.js";

const server = new OcServer({} , {
  directory: "/tmp/test-blocks-dir",
  getSelection: () => ({ provider: "deepseek", model: "deepseek-v4-flash" }),
  onPrompt: async () => undefined,
});
server.store.getOrCreateSession("ses_test", "/tmp/test-blocks-dir");
server.store.sessions.get("ses_test").dshSessionId = "dsh-test";

const S = { id: "dsh-test" };
const chunk = (step, c) => server.handleDshEvent(S, { type: "assistant/chunk", seq: 1, time: Date.now(), data: { step, chunk: c } });

server.handleDshEvent(S, { type: "turn/start", seq: 1, time: Date.now(), data: {} });
// 思考1
chunk(1, { type: "block-start", index: 0, blockType: "reasoning" });
chunk(1, { type: "reasoning-delta", index: 0, text: "First thinking" });
chunk(1, { type: "block-end", index: 0, block: { type: "reasoning" } });
// 输出1
chunk(1, { type: "block-start", index: 1, blockType: "text" });
chunk(1, { type: "text-delta", index: 1, text: "First output" });
chunk(1, { type: "block-end", index: 1, block: { type: "text" } });
// 思考2
chunk(2, { type: "block-start", index: 0, blockType: "reasoning" });
chunk(2, { type: "reasoning-delta", index: 0, text: "Second thinking" });
chunk(2, { type: "block-end", index: 0, block: { type: "reasoning" } });
// 输出2
chunk(2, { type: "block-start", index: 1, blockType: "text" });
chunk(2, { type: "text-delta", index: 1, text: "Second output" });
chunk(2, { type: "block-end", index: 1, block: { type: "text" } });
server.handleDshEvent(S, { type: "turn/end", seq: 2, time: Date.now(), data: { reason: { kind: "completed" } } });

const state = server.store.sessions.get("ses_test");
const msg = state.messages.at(-1);
// 模拟 TUI 排序：按 part id 字典序
const sorted = [...msg.parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const seq = sorted.map((p) => `${p.type}:${p.text}`);
console.log("parts (TUI 排序后):", seq);
const expected = ["reasoning:First thinking", "text:First output", "reasoning:Second thinking", "text:Second output"];
const ok = seq.length === 4 && seq.every((s, i) => s === expected[i]);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
