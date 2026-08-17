// 单元验证：tool part 的 state.time 必填（Read 组件读 state.time.compacted 防崩溃）
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
// read 工具（Read 组件会读 state.time.compacted）
server.handleDshEvent(S, { type: "tool/call", seq: 1, time: Date.now(), data: { callId: "call_00_abc", name: "read", arguments: '{"filePath":"/tmp/x"}' } });
server.handleDshEvent(S, { type: "tool/result", seq: 1, time: Date.now(), data: { message: { content: [{ type: "tool-result", toolCallId: "call_00_abc", content: [{ type: "text", text: "file content" }], isError: false }] } } });
server.handleDshEvent(S, { type: "turn/end", seq: 2, time: Date.now(), data: { reason: { kind: "completed" } } });

const state = server.store.sessions.get("ses_test");
const msg = state.messages.at(-1);
const tool = msg.parts.find((p) => p.type === "tool");
const st = tool.state;
console.log("status:", st.status, "| time:", JSON.stringify(st.time), "| output:", JSON.stringify(st.output));
// 模拟 Read 组件的访问：completed 时读 state.time.compacted
let crash = false;
try {
  const compacted = st.status === "completed" ? st.time.compacted : undefined;
  void compacted;
} catch {
  crash = true;
}
const ok = st.time && typeof st.time.start === "number" && st.time.end !== undefined && !crash;
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
