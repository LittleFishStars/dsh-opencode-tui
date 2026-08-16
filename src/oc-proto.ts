/**
 * opencode 协议类型与构造辅助（对齐 anomalyco/opencode v2 schema）。
 *
 * 只实现兼容层需要的子集：Session / SessionMessage / V2Event 及其构造器。
 */
import { createHash } from "node:crypto";

// ── id 生成 ────────────────────────────────────────────────────────────────

let seq = 0;

/** 生成 opencode 风格 id：ses_ / msg_ / evt_ 前缀 + 递增 base36（保证排序稳定）。 */
export function ocId(prefix: "ses" | "msg" | "evt" | "text" | "reasoning" | "call"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(6, "0")}`;
}

// ── 类型 ───────────────────────────────────────────────────────────────────

export interface LocationRef {
  directory: string;
  workspaceID?: string;
}

export interface LocationInfo {
  directory: string;
  workspaceID?: string;
  project: { id: string; directory: string };
}

/** v2 端点响应包装：{ location, data } */
export interface LocatedResponse<T> {
  location: LocationInfo;
  data: T;
}

export function located<T>(data: T, directory: string): LocatedResponse<T> {
  return { location: locationInfo(directory), data };
}

export function locationInfo(directory: string): LocationInfo {
  return {
    directory,
    project: { id: projectId(directory), directory },
  };
}

/** project id：fork 用 git 根目录的 sha1，这里用 cwd 的 sha1 近似（稳定性足够）。 */
export function projectId(directory: string): string {
  return createHash("sha1").update(directory).digest("hex");
}

// ── Session.Info ───────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  parentID?: string;
  projectID: string;
  agent?: string;
  model?: ModelRef;
  cost: number;
  tokens: TokenUsage;
  time: { created: number; updated: number; archived?: number };
  title: string;
  location: LocationRef;
  subpath?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export function makeSessionInfo(init: {
  id: string;
  directory: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  created?: number;
  updated?: number;
}): SessionInfo {
  const now = Date.now();
  return {
    id: init.id,
    projectID: projectId(init.directory),
    agent: init.agent,
    model: init.model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: init.created ?? now, updated: init.updated ?? now },
    title: init.title ?? "New Session",
    location: { directory: init.directory },
  };
}

// ── SessionMessage ─────────────────────────────────────────────────────────

export interface MessageBase {
  id: string;
  time: { created: number };
}

export interface UserMessage extends MessageBase {
  type: "user";
  text: string;
  files?: unknown[];
  agents?: unknown[];
}

export interface AssistantTextPart {
  type: "text";
  id: string;
  text: string;
}

export interface AssistantReasoningPart {
  type: "reasoning";
  id: string;
  text: string;
}

export interface ToolState {
  status: "pending" | "running" | "completed" | "error";
  input: Record<string, unknown>;
  content: unknown[];
  structured: Record<string, unknown>;
  error?: { type: "unknown"; message: string };
  result?: unknown;
}

export interface AssistantToolPart {
  type: "tool";
  id: string;
  name: string;
  state: ToolState;
  time: { created: number; ran?: number; completed?: number };
}

export type AssistantContentPart = AssistantTextPart | AssistantReasoningPart | AssistantToolPart;

export interface AssistantMessage extends MessageBase {
  type: "assistant";
  agent: string;
  model: ModelRef;
  content: AssistantContentPart[];
  finish?: string;
  cost?: number;
  tokens?: TokenUsage;
  error?: { type: "unknown"; message: string };
  time: { created: number; completed?: number };
}

export interface ShellMessage extends MessageBase {
  type: "shell";
  callID: string;
  command: string;
  output: string;
  time: { created: number; completed?: number };
}

export interface SystemMessage extends MessageBase {
  type: "system";
  text: string;
}

export interface SyntheticMessage extends MessageBase {
  type: "synthetic";
  sessionID: string;
  text: string;
}

export interface AgentSwitchedMessage extends MessageBase {
  type: "agent-switched";
  agent: string;
}

export interface ModelSwitchedMessage extends MessageBase {
  type: "model-switched";
  model: ModelRef;
}

export type SessionMessage =
  | UserMessage
  | AssistantMessage
  | ShellMessage
  | SystemMessage
  | SyntheticMessage
  | AgentSwitchedMessage
  | ModelSwitchedMessage;

// ── V2Event ────────────────────────────────────────────────────────────────

export interface V2EventBase {
  id: string;
  type: string;
  durable?: { aggregateID: string; seq: number; version: number };
  location?: LocationRef;
  metadata?: Record<string, unknown>;
}

export interface V2Event<T extends string = string, D = unknown> extends V2EventBase {
  type: T;
  data: D;
}

let evtSeq = 0;

export function makeEvent<T extends string, D>(
  type: T,
  data: D,
  opts?: { location?: LocationRef; durable?: { aggregateID: string; seq: number; version: number } },
): V2Event<T, D> {
  evtSeq += 1;
  return {
    id: `evt_${Date.now().toString(36)}${evtSeq.toString(36).padStart(6, "0")}`,
    type,
    data,
    ...(opts?.durable ? { durable: opts.durable } : {}),
    ...(opts?.location ? { location: opts.location } : {}),
  };
}

/** 会话事件 data 的公共字段 */
export interface SessionEventDataBase {
  timestamp: number;
  sessionID: string;
}

export function promptData(
  sessionID: string,
  messageID: string,
  text: string,
): SessionEventDataBase & {
  messageID: string;
  prompt: { text: string; files?: unknown[]; agents?: unknown[] };
  delivery: string;
} {
  return {
    timestamp: Date.now(),
    sessionID,
    messageID,
    prompt: { text },
    delivery: "direct",
  };
}

export function stepStartedData(
  sessionID: string,
  assistantMessageID: string,
  agent: string,
  model: ModelRef,
): SessionEventDataBase & { assistantMessageID: string; agent: string; model: ModelRef } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, agent, model };
}

export function stepEndedData(
  sessionID: string,
  assistantMessageID: string,
  finish: string,
): SessionEventDataBase & {
  assistantMessageID: string;
  finish: string;
  cost: number;
  tokens: TokenUsage;
} {
  return {
    timestamp: Date.now(),
    sessionID,
    assistantMessageID,
    finish,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

export function textStartedData(
  sessionID: string,
  assistantMessageID: string,
  textID: string,
): SessionEventDataBase & { assistantMessageID: string; textID: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, textID };
}

export function textDeltaData(
  sessionID: string,
  assistantMessageID: string,
  textID: string,
  delta: string,
): SessionEventDataBase & { assistantMessageID: string; textID: string; delta: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, textID, delta };
}

export function textEndedData(
  sessionID: string,
  assistantMessageID: string,
  textID: string,
  text: string,
): SessionEventDataBase & { assistantMessageID: string; textID: string; text: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, textID, text };
}

export function reasoningStartedData(
  sessionID: string,
  assistantMessageID: string,
  reasoningID: string,
): SessionEventDataBase & { assistantMessageID: string; reasoningID: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID };
}

export function reasoningDeltaData(
  sessionID: string,
  assistantMessageID: string,
  reasoningID: string,
  delta: string,
): SessionEventDataBase & { assistantMessageID: string; reasoningID: string; delta: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID, delta };
}

export function reasoningEndedData(
  sessionID: string,
  assistantMessageID: string,
  reasoningID: string,
  text: string,
): SessionEventDataBase & { assistantMessageID: string; reasoningID: string; text: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, reasoningID, text };
}

export function toolInputStartedData(
  sessionID: string,
  assistantMessageID: string,
  callID: string,
  name: string,
): SessionEventDataBase & { assistantMessageID: string; callID: string; name: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, callID, name };
}

export function toolInputEndedData(
  sessionID: string,
  assistantMessageID: string,
  callID: string,
  text: string,
): SessionEventDataBase & { assistantMessageID: string; callID: string; text: string } {
  return { timestamp: Date.now(), sessionID, assistantMessageID, callID, text };
}

export function toolCalledData(
  sessionID: string,
  assistantMessageID: string,
  callID: string,
  tool: string,
  input: Record<string, unknown>,
): SessionEventDataBase & {
  assistantMessageID: string;
  callID: string;
  tool: string;
  input: Record<string, unknown>;
  provider: { executed: boolean };
} {
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

export function toolSuccessData(
  sessionID: string,
  assistantMessageID: string,
  callID: string,
  content: unknown[],
  structured: Record<string, unknown>,
  result?: unknown,
): SessionEventDataBase & {
  assistantMessageID: string;
  callID: string;
  structured: Record<string, unknown>;
  content: unknown[];
  result?: unknown;
  provider: { executed: boolean };
} {
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

export function toolFailedData(
  sessionID: string,
  assistantMessageID: string,
  callID: string,
  message: string,
): SessionEventDataBase & {
  assistantMessageID: string;
  callID: string;
  error: { type: "unknown"; message: string };
  provider: { executed: boolean };
} {
  return {
    timestamp: Date.now(),
    sessionID,
    assistantMessageID,
    callID,
    error: { type: "unknown", message },
    provider: { executed: true },
  };
}

export function shellStartedData(
  sessionID: string,
  messageID: string,
  callID: string,
  command: string,
): SessionEventDataBase & { messageID: string; callID: string; command: string } {
  return { timestamp: Date.now(), sessionID, messageID, callID, command };
}

export function shellEndedData(
  sessionID: string,
  callID: string,
  output: string,
): SessionEventDataBase & { callID: string; output: string } {
  return { timestamp: Date.now(), sessionID, callID, output };
}

// ── Agent.Info / 旧协议类型 ────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  model?: ModelRef;
  request: { headers: Record<string, unknown>; body: Record<string, unknown> };
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  color?: string;
  steps?: number;
  permissions: unknown[];
}

export function makeAgentInfo(id: string, description?: string): AgentInfo {
  return {
    id,
    request: { headers: {}, body: {} },
    description,
    mode: "primary",
    hidden: false,
    permissions: [],
  };
}

/** 旧协议 Provider（/config/providers 用） */
export interface LegacyProvider {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "api";
  env: string[];
  options: Record<string, unknown>;
  models: Record<string, LegacyModel>;
}

export interface LegacyModel {
  id: string;
  providerID: string;
  family?: string;
  name: string;
  limit?: { context: number; output: number };
  cost?: { input: number; output: number };
  options?: Record<string, unknown>;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
}

/** 把 v2 Model.Info 转成旧协议 Model（/config/providers 的 models 表）。 */
export function legacyModelFromV2(info: {
  id: string;
  providerID: string;
  name: string;
  family?: string;
}): LegacyModel {
  return {
    id: info.id,
    providerID: info.providerID,
    family: info.family,
    name: info.name,
    limit: { context: 131072, output: 65536 },
    cost: { input: 0, output: 0 },
    attachment: true,
    reasoning: true,
    toolCall: true,
  };
}
