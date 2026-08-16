/**
 * opencode 协议类型与构造辅助（对齐 anomalyco/opencode v2 schema）。
 *
 * 只实现兼容层需要的子集：Session / SessionMessage / V2Event 及其构造器。
 */
import { createHash } from "node:crypto";
// ── id 生成 ────────────────────────────────────────────────────────────────
let seq = 0;
/** 生成 opencode 风格 id：ses_ / msg_ / evt_ 前缀 + 递增 base36（保证排序稳定）。 */
export function ocId(prefix) {
    seq += 1;
    return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(6, "0")}`;
}
export function located(data, directory) {
    return { location: locationInfo(directory), data };
}
export function locationInfo(directory) {
    return {
        directory,
        project: { id: projectId(directory), directory },
    };
}
/** project id：fork 用 git 根目录的 sha1，这里用 cwd 的 sha1 近似（稳定性足够）。 */
export function projectId(directory) {
    return createHash("sha1").update(directory).digest("hex");
}
export function makeSessionInfo(init) {
    const now = Date.now();
    return {
        id: init.id,
        projectID: projectId(init.directory),
        agent: init.agent,
        model: init.model,
        cost: init.cost ?? 0,
        tokens: init.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: init.created ?? now, updated: init.updated ?? now },
        title: init.title ?? "New Session",
        location: { directory: init.directory },
    };
}
let evtSeq = 0;
export function makeEvent(type, data, opts) {
    evtSeq += 1;
    return {
        id: `evt_${Date.now().toString(36)}${evtSeq.toString(36).padStart(6, "0")}`,
        type,
        data,
        ...(opts?.durable ? { durable: opts.durable } : {}),
        ...(opts?.location ? { location: opts.location } : {}),
    };
}
export function promptData(sessionID, messageID, text) {
    return {
        timestamp: Date.now(),
        sessionID,
        messageID,
        prompt: { text },
        delivery: "direct",
    };
}
export function stepStartedData(sessionID, assistantMessageID, agent, model) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, agent, model };
}
export function stepEndedData(sessionID, assistantMessageID, finish) {
    return {
        timestamp: Date.now(),
        sessionID,
        assistantMessageID,
        finish,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
}
export function textStartedData(sessionID, assistantMessageID, textID) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, textID };
}
export function textDeltaData(sessionID, assistantMessageID, textID, delta) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, textID, delta };
}
export function textEndedData(sessionID, assistantMessageID, textID, text) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, textID, text };
}
export function reasoningStartedData(sessionID, assistantMessageID, reasoningID) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID };
}
export function reasoningDeltaData(sessionID, assistantMessageID, reasoningID, delta) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID, delta };
}
export function reasoningEndedData(sessionID, assistantMessageID, reasoningID, text) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID, text };
}
export function toolInputStartedData(sessionID, assistantMessageID, callID, name) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, callID, name };
}
export function toolInputEndedData(sessionID, assistantMessageID, callID, text) {
    return { timestamp: Date.now(), sessionID, assistantMessageID, callID, text };
}
export function toolCalledData(sessionID, assistantMessageID, callID, tool, input) {
    return {
        timestamp: Date.now(),
        sessionID,
        assistantMessageID,
        callID,
        tool,
        input,
        provider: { executed: true },
    };
}
export function toolSuccessData(sessionID, assistantMessageID, callID, content, structured, result) {
    return {
        timestamp: Date.now(),
        sessionID,
        assistantMessageID,
        callID,
        structured,
        content,
        ...(result !== undefined ? { result } : {}),
        provider: { executed: true },
    };
}
export function toolFailedData(sessionID, assistantMessageID, callID, message) {
    return {
        timestamp: Date.now(),
        sessionID,
        assistantMessageID,
        callID,
        error: { type: "unknown", message },
        provider: { executed: true },
    };
}
export function shellStartedData(sessionID, messageID, callID, command) {
    return { timestamp: Date.now(), sessionID, messageID, callID, command };
}
export function shellEndedData(sessionID, callID, output) {
    return { timestamp: Date.now(), sessionID, callID, output };
}
export function makeAgentInfo(id, description) {
    return {
        id,
        request: { headers: {}, body: {} },
        description,
        mode: "primary",
        hidden: false,
        permissions: [],
    };
}
/** 把 v2 Model.Info 转成旧协议 Model（/config/providers 的 models 表）。 */
export function legacyModelFromV2(info, contextWindow) {
    return {
        id: info.id,
        providerID: info.providerID,
        family: info.family,
        name: info.name,
        limit: { context: contextWindow ?? 131072, output: 65536 },
        cost: { input: 0, output: 0 },
        attachment: true,
        reasoning: true,
        toolCall: true,
    };
}
//# sourceMappingURL=oc-proto.js.map