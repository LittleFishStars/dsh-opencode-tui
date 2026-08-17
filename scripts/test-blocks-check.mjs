// 单元验证：工具完成状态含 output/title/metadata.output（Shell 点击展开依赖）
import { OcServer } from "../lib/oc-server.js";

const server = new OcServer({} , {
  directory: "/tmp/test-blocks-dir",
  getSelection: () => ({ provider: "deepseek", model: "deepseek-v4-flash" }),
  onPrompt: async () => undefined,
});
server.store.getOrCreateSession("ses_test", "/tmp/test-blocks-dir");
server.store.sessions.get("ses_test").dshSessionId = "dsh-test";

const S = { id: "dsh-test" };
server.handleDshEvent(S, { type: "turn/start", seq: 1, time: Date.now(), data: {} });
server.handleDshEvent(S, { type: "tool/call", seq: 1, time: Date.now(), data: { callId: "call_00_abc", name: "bash", arguments: '{"command":"echo hi"}' } });
server.handleDshEvent(S, { type: "tool/result", seq: 1, time: Date.now(), data: { message: { content: [{ callId: "call_00_abc" }, { type: "text", text: "hello world" }] } } });
server.handleDshEvent(S, { type: "turn/end", seq: 2, time: Date.now(), data: { reason: { kind: "completed" } } });

const state = server.store.sessions.get("ses_test");
const msg = state.messages.at(-1);
const tool = msg.parts.find((p) => p.type === "tool");
console.log("tool state:", JSON.stringify(tool.state, null, 1));
const ok = tool.state.status === "completed"
  && tool.state.output === "hello world"
  && tool.state.title === "Bash"
  && tool.state.metadata?.output === "hello world";
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
