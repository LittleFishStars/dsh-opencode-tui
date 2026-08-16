/**
 * TUI 中央状态：用 useSyncExternalStore 订阅的不可变快照 store。
 * 所有写入都走 TuiStore 方法，最后统一 emit。
 */
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";
import type { MessageView, SessionMeta } from "./projection.js";

export type DialogName = "quit" | "help" | "sessions" | "commands" | "models" | "theme" | "filepicker" | "init";

export interface Notification {
  type: "info" | "warn" | "error";
  message: string;
  ttlMs: number;
  at: number;
}

export interface ApprovalSnapshot {
  key: string;
  toolName: string;
  reason?: string;
  command?: string;
}

export interface WorkingState {
  /** 当前 agent 是否忙碌 */
  busy: boolean;
  /** 忙碌时的状态文案（Thinking.../Generating.../Building tool call.../Waiting for tool response...） */
  task: string;
  /** 转圈帧（由 App 驱动） */
  spinFrame: number;
}

export interface ModelSelectionInfo {
  provider: string;
  model: string;
  reasoning?: string;
}

export interface Snapshot {
  sessions: SessionMeta[];
  /** 会话列表是否加载完成 */
  sessionsLoaded: boolean;
  currentSessionId: string | null;
  messages: MessageView[];
  /** 当前会话的标题（sidebar 用） */
  currentTitle: string;
  working: WorkingState;
  approval: ApprovalSnapshot | null;
  model: ModelSelectionInfo | null;
  themeName: string;
  dialogs: Record<DialogName, boolean>;
  showSidebar: boolean;
  notification: Notification | null;
  /** 事件驱动型转场（如会话切换中） */
  loadingSession: boolean;
  cwd: string;
}

const initialSnapshot: Snapshot = {
  sessions: [],
  sessionsLoaded: false,
  currentSessionId: null,
  messages: [],
  currentTitle: "",
  working: { busy: false, task: "", spinFrame: 0 },
  approval: null,
  model: null,
  themeName: "opencode",
  dialogs: {
    quit: false,
    help: false,
    sessions: false,
    commands: false,
    models: false,
    theme: false,
    filepicker: false,
    init: false,
  },
  showSidebar: false,
  notification: null,
  loadingSession: false,
  cwd: process.cwd(),
};

export class TuiStore {
  private snapshot: Snapshot = initialSnapshot;
  private readonly listeners = new Set<() => void>();
  /** 通知自动过期定时器 */
  private notificationTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  /** 直接 patch 快照（内部工具，用于批量更新）。 */
  set(patch: Partial<Snapshot> | ((prev: Snapshot) => Partial<Snapshot>)): void {
    const next =
      typeof patch === "function"
        ? { ...this.snapshot, ...patch(this.snapshot) }
        : { ...this.snapshot, ...patch };
    this.snapshot = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  // ── 会话 ────────────────────────────────────────────────────────────────

  setSessions(sessions: SessionMeta[], loaded = true): void {
    this.set({ sessions, sessionsLoaded: loaded });
  }

  setCurrentSession(sessionId: string | null, title: string): void {
    this.set({ currentSessionId: sessionId, currentTitle: title, showSidebar: sessionId !== null });
  }

  setMessages(messages: MessageView[]): void {
    this.set({ messages });
  }

  setLoadingSession(loading: boolean): void {
    this.set({ loadingSession: loading });
  }

  /** 会话切换：清空当前消息并进入加载态。 */
  beginSessionSwitch(sessionId: string | null): void {
    this.set({
      currentSessionId: sessionId,
      messages: [],
      loadingSession: true,
      showSidebar: sessionId !== null,
      currentTitle: "",
    });
  }

  // ── 工作状态 ────────────────────────────────────────────────────────────

  setWorking(working: Partial<WorkingState>): void {
    this.set((prev) => ({ working: { ...prev.working, ...working } }));
  }

  tickSpinner(): void {
    this.set((prev) => ({
      working: { ...prev.working, spinFrame: prev.working.spinFrame + 1 },
    }));
  }

  // ── 审批 ────────────────────────────────────────────────────────────────

  setApproval(approval: ApprovalSnapshot | null): void {
    this.set({ approval });
  }

  // ── 模型 ────────────────────────────────────────────────────────────────

  setModel(model: ModelSelectionInfo | null): void {
    this.set({ model });
  }

  // ── 主题 ────────────────────────────────────────────────────────────────

  setTheme(themeName: string): void {
    this.set({ themeName });
  }

  // ── 对话框 ──────────────────────────────────────────────────────────────

  toggleDialog(name: DialogName): void {
    this.set((prev) => ({
      dialogs: { ...prev.dialogs, [name]: !prev.dialogs[name] },
    }));
  }

  openDialog(name: DialogName): void {
    this.set((prev) => ({
      dialogs: { ...prev.dialogs, [name]: true },
    }));
  }

  closeDialog(name: DialogName): void {
    this.set((prev) => ({
      dialogs: { ...prev.dialogs, [name]: false },
    }));
  }

  closeAllDialogs(): void {
    this.set((prev) => ({
      dialogs: {
        quit: false,
        help: false,
        sessions: false,
        commands: false,
        models: false,
        theme: false,
        filepicker: false,
        init: false,
      },
    }));
  }

  // ── 通知 ────────────────────────────────────────────────────────────────

  notify(type: Notification["type"], message: string, ttlMs = 4000): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.set({ notification: { type, message, ttlMs, at: Date.now() } });
    this.notificationTimer = setTimeout(() => {
      this.set({ notification: null });
    }, ttlMs);
  }

  clearNotification(): void {
    if (this.notificationTimer) clearTimeout(this.notificationTimer);
    this.set({ notification: null });
  }

  // ── 杂项 ────────────────────────────────────────────────────────────────

  setSidebar(show: boolean): void {
    this.set({ showSidebar: show });
  }
}

/** 全局唯一 store 实例（由插件创建并注入）。 */
export let store: TuiStore | undefined;

export function setGlobalStore(s: TuiStore): void {
  store = s;
}

export function getStore(): TuiStore {
  if (!store) throw new Error("TuiStore not initialized");
  return store;
}

// 审批请求队列（approval/request 处理见 plugin.ts）
interface ParkedApproval {
  req: ApprovalRequest;
  resolve: (outcome: ApprovalOutcome) => void;
}

export class ApprovalQueue {
  private queue: ParkedApproval[] = [];
  private active: ParkedApproval | null = null;
  private seq = 0;
  private readonly listeners = new Set<() => void>();
  private snapshotCache: ApprovalSnapshot | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ApprovalSnapshot | null => this.snapshotCache;

  /**
   * 挂起一个审批请求，返回会在此队列给出决定时兑现的 promise。
   * abort 信号触发时按协议以 'cancelled' 结算。
   */
  park(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const done = Promise.withResolvers<ApprovalOutcome>();
    this.queue.push({ req, resolve: done.resolve });
    this.drain();
    if (req.signal) {
      if (req.signal.aborted) {
        this.withdraw(req);
      } else {
        req.signal.addEventListener(
          "abort",
          () => this.withdraw(req),
          { once: true },
        );
      }
    }
    return done.promise;
  }

  private withdraw(req: ApprovalRequest): void {
    const idx = this.queue.findIndex((p) => p.req === req);
    if (idx >= 0) {
      const [parked] = this.queue.splice(idx, 1);
      parked?.resolve("cancelled");
    }
    if (this.active?.req === req) {
      this.active.resolve("cancelled");
      this.active = null;
      this.drain();
    }
    this.rebuild();
  }

  private drain(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.rebuild();
      return;
    }
    this.active = next;
    this.rebuild();
  }

  /** 用户决定当前审批。 */
  decide(outcome: "allowed-once" | "rejected"): void {
    const current = this.active;
    if (!current) return;
    this.active = null;
    current.resolve(outcome);
    this.drain();
  }

  /** 全部取消（插件卸载 / agent 释放时）。 */
  settleAll(outcome: ApprovalOutcome): void {
    const list = [...this.queue];
    this.queue = [];
    if (this.active) {
      list.push(this.active);
      this.active = null;
    }
    for (const parked of list) parked.resolve(outcome);
    this.rebuild();
  }

  private rebuild(): void {
    const current = this.active;
    let next: ApprovalSnapshot | null = null;
    if (current) {
      next = {
        key: `approval-${++this.seq}`,
        toolName: current.req.toolName,
        reason: current.req.reason,
        command: undefined,
      };
    }
    this.snapshotCache = next;
    for (const listener of this.listeners) listener();
  }
}

export let approvalQueue: ApprovalQueue | undefined;

export function setApprovalQueue(q: ApprovalQueue): void {
  approvalQueue = q;
}

export function getApprovalQueue(): ApprovalQueue | undefined {
  return approvalQueue;
}

// ── 用户提问队列（ask_user_question 工具） ─────────────────────────────────

import type { AskUserQuestionAnswer, AskUserQuestionRequest } from "@deepseek-ai/dsh-user-questions";

interface QuestionParked {
  request: AskUserQuestionRequest;
  resolve: (answer: AskUserQuestionAnswer) => void;
}

/** 提问队列：一次挂起一个请求，TUI 渲染选项菜单，answer() 结算。 */
export class QuestionQueue {
  private queue: QuestionParked[] = [];
  private active: QuestionParked | null = null;
  private listeners = new Set<() => void>();
  private snapshotCache: AskUserQuestionRequest | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AskUserQuestionRequest | null => this.snapshotCache;

  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const done = Promise.withResolvers<AskUserQuestionAnswer>();
    this.queue.push({ request, resolve: done.resolve });
    this.drain();
    request.signal?.addEventListener("abort", () => this.withdraw(request), { once: true });
    return done.promise;
  }

  private withdraw(request: AskUserQuestionRequest): void {
    const idx = this.queue.findIndex((p) => p.request === request);
    if (idx >= 0) {
      const [parked] = this.queue.splice(idx, 1);
      parked?.resolve({ answers: [] });
    }
    if (this.active?.request === request) {
      this.active.resolve({ answers: [] });
      this.active = null;
      this.drain();
    }
    this.emit();
  }

  private drain(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) {
      this.emit();
      return;
    }
    this.active = next;
    this.emit();
  }

  /** 用户回答了当前问题。 */
  answer(answer: AskUserQuestionAnswer): void {
    const current = this.active;
    if (!current) return;
    this.active = null;
    current.resolve(answer);
    this.drain();
  }

  /** 清空（插件卸载）。 */
  settleAll(): void {
    const list = [...this.queue];
    this.queue = [];
    if (this.active) {
      list.push(this.active);
      this.active = null;
    }
    for (const parked of list) parked.resolve({ answers: [] });
    this.emit();
  }

  private emit(): void {
    this.snapshotCache = this.active?.request ?? null;
    for (const listener of this.listeners) listener();
  }
}

export let questionQueue: QuestionQueue | undefined;

export function setQuestionQueue(q: QuestionQueue): void {
  questionQueue = q;
}

export function getQuestionQueue(): QuestionQueue | undefined {
  return questionQueue;
}
