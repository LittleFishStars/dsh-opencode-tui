// 单元验证：两段思考 → 两个独立 reasoning part（live 路径）
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
chunk(1, { type: "block-start", index: 0, blockType: "reasoning" });
chunk(1, { type: "reasoning-delta", index: 0, text: "First thinking" });
chunk(1, { type: "block-end", index: 0, block: { type: "reasoning" } });
chunk(1, { type: "block-start", index: 1, blockType: "text" });
chunk(1, { type: "text-delta", index: 1, text: "First output" });
chunk(1, { type: "block-end", index: 1, block: { type: "text" } });
chunk(2, { type: "block-start", index: 0, blockType: "reasoning" });
chunk(2, { type: "reasoning-delta", index: 0, text: "Second thinking" });
chunk(2, { type: "block-end", index: 0, block: { type: "reasoning" } });
chunk(2, { type: "block-start", index: 1, blockType: "text" });
chunk(2, { type: "text-delta", index: 1, text: "Second output" });
chunk(2, { type: "block-end", index: 1, block: { type: "text" } });
server.handleDshEvent(S, { type: "turn/end", seq: 2, time: Date.now(), data: { reason: { kind: "completed" } } });

const state = server.store.sessions.get("ses_test");
const msg = state.messages.at(-1);
const reasoning = msg.parts.filter((p) => p.type === "reasoning");
console.log("reasoning parts:", reasoning.length);
for (const r of reasoning) console.log(" -", JSON.stringify({ text: r.text, hasEnd: r.time.end !== undefined }));
const ok = reasoning.length === 2
  && reasoning[0].text === "First thinking" && reasoning[0].time.end !== undefined
  && reasoning[1].text === "Second thinking" && reasoning[1].time.end !== undefined
  && reasoning[0].id !== reasoning[1].id;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
