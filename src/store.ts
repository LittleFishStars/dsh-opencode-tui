/**
 * 桥插件共享状态：审批与提问队列（纯逻辑，无 UI 依赖）。
 */
import type { ApprovalOutcome, ApprovalRequest } from "@deepseek-ai/dsh-user-approval";

export interface ApprovalSnapshot {
  key: string;
  toolName: string;
  reason?: string;
  command?: string;
}

// ── 审批请求队列（approval/request 处理见 bridge.ts） ────────────────────────

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
        req.signal.addEventListener("abort", () => this.withdraw(req), { once: true });
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

// ── 用户提问队列（ask_user_question 工具） ─────────────────────────────────

import type { AskUserQuestionAnswer, AskUserQuestionRequest } from "@deepseek-ai/dsh-user-questions";

interface QuestionParked {
  request: AskUserQuestionRequest;
  resolve: (answer: AskUserQuestionAnswer) => void;
}

/** 提问队列：一次挂起一个请求，answer() 结算。 */
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
