// 单元验证：排队场景下 user 消息不重复（POST 添加后，延迟的 user/message 事件被跳过）
import { OcServer } from "../lib/oc-server.js";

const server = new OcServer({} , {
  directory: "/tmp/test-blocks-dir",
  getSelection: () => ({ provider: "deepseek", model: "deepseek-v4-flash" }),
  onPrompt: async () => undefined,
});
server.store.getOrCreateSession("ses_test", "/tmp/test-blocks-dir");
server.store.sessions.get("ses_test").dshSessionId = "dsh-test";
const S = { id: "dsh-test" };

// 1. POST /session/:id/message 添加 user1 + 触发
const state = server.store.sessions.get("ses_test");
state.messages.push({
  info: { id: "msg_1", sessionID: "ses_test", role: "user", time: { created: 1000, updated: 1000 }, agent: "workspace-write", model: { providerID: "p", modelID: "m" } },
  parts: [{ id: "prt_1", sessionID: "ses_test", messageID: "msg_1", type: "text", text: "question one", time: { start: 1000, end: 1000 } }],
});

// 2. turn1 开始（busy）
server.handleDshEvent(S, { type: "turn/start", seq: 2, time: 1500, data: {} });

// 3. 上一轮未结束时发送 user2（POST 添加）
state.messages.push({
  info: { id: "msg_2", sessionID: "ses_test", role: "user", time: { created: 2000, updated: 2000 }, agent: "workspace-write", model: { providerID: "p", modelID: "m" } },
  parts: [{ id: "prt_2", sessionID: "ses_test", messageID: "msg_2", type: "text", text: "question two", time: { start: 2000, end: 2000 } }],
});

// 4. turn1 结束（60 秒后，超过旧的 5 秒窗口）
server.handleDshEvent(S, { type: "turn/end", seq: 3, time: 65000, data: { reason: { kind: "completed" } } });

// 5. turn2 开始，DSH 发 user/message(user2) 事件（延迟到达）
server.handleDshEvent(S, { type: "user/message", seq: 4, time: 66000, data: { content: [{ type: "text", text: "question two" }], source: { kind: "user" } } });

const users = state.messages.filter((m) => m.info.role === "user");
console.log("user messages:", users.length, users.map((u) => u.parts[0]?.text));
const ok = users.length === 2; // user1 + user2（不重复）
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
