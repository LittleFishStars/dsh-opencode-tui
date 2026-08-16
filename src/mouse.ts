/**
 * 鼠标支持：SGR 鼠标协议（\x1b[<b;x;yM/m）解析 + 输入分流。
 *
 * Ink 的按键解析器不认识鼠标序列，所以这里在 process.stdin 与 Ink 之间
 * 插入一个分流层：鼠标序列被解析为 MouseEvent 事件，其余字节透传给 Ink。
 *
 * 终端模式：?1000h（点击/释放/滚轮）+ ?1006h（SGR 扩展坐标）。
 */
import { PassThrough } from "node:stream";

export type MouseEventData =
  | {
      type: "mousedown";
      button: number; // 0 左 1 中 2 右
      x: number; // 1-based 屏幕列
      y: number; // 1-based 屏幕行
    }
  | {
      type: "mouseup";
      button: number;
      x: number;
      y: number;
    }
  | {
      type: "wheel";
      /** +1 向下滚（内容向上），-1 向上滚 */
      dx: number;
      x: number;
      y: number;
    };

const MOUSE_ENABLE = "\x1b[?1000h\x1b[?1006h";
const MOUSE_DISABLE = "\x1b[?1000l\x1b[?1006l";

/** SGR 鼠标序列：\x1b[<b;x;yM（按下/滚轮）或 m（释放） */
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

export class MouseController {
  private buffer = "";
  private listeners = new Set<(e: MouseEventData) => void>();
  /** 是否已启用终端鼠标模式 */
  enabled = false;

  on(listener: (e: MouseEventData) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: MouseEventData): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* 单个监听器失败不影响其余 */
      }
    }
  }

  /**
   * 吞掉 chunk 里的鼠标序列，返回应透传给 Ink 的剩余字节。
   * 支持跨 chunk 的序列（内部缓冲）。
   */
  ingest(chunk: string): string {
    let rest = this.buffer + chunk;
    this.buffer = "";
    let out = "";
    while (rest.length > 0) {
      if (rest.startsWith("\x1b[<")) {
        const match = SGR_MOUSE_RE.exec(rest);
        if (match) {
          const buttonRaw = Number.parseInt(match[1]!, 10);
          const x = Number.parseInt(match[2]!, 10);
          const y = Number.parseInt(match[3]!, 10);
          const press = match[4] === "M";
          this.handleSgr(buttonRaw, x, y, press);
          rest = rest.slice(match[0].length);
          continue;
        }
        // 序列不完整：可能是跨 chunk 的尾部，缓冲等下一块
        if (rest.length < 8) {
          this.buffer = rest;
          return out;
        }
        // 不是合法的鼠标序列，原样透传
        out += "\x1b";
        rest = rest.slice(1);
        continue;
      }
      // 普通字节：透传（注意保留 \x1b 开头但非鼠标的序列给 Ink 解析）
      out += rest[0];
      rest = rest.slice(1);
    }
    return out;
  }

  private handleSgr(buttonRaw: number, x: number, y: number, press: boolean): void {
    const button = buttonRaw & 0b11;
    const motion = (buttonRaw & 0b100000) !== 0;
    if (buttonRaw >= 64 && buttonRaw <= 65) {
      // 滚轮：64 上滚，65 下滚
      this.emit({ type: "wheel", dx: buttonRaw === 65 ? 1 : -1, x, y });
      return;
    }
    if (motion) {
      return; // 拖动事件忽略（v1）
    }
    if (press) {
      this.emit({ type: "mousedown", button, x, y });
    } else {
      this.emit({ type: "mouseup", button, x, y });
    }
  }

  /** 启用终端鼠标模式（应写入 stdout）。 */
  enable(): void {
    this.enabled = true;
  }

  /** 禁用终端鼠标模式。 */
  disable(): void {
    this.enabled = false;
  }
}

export const MOUSE_ENABLE_SEQUENCE = MOUSE_ENABLE;
export const MOUSE_DISABLE_SEQUENCE = MOUSE_DISABLE;

/**
 * 传给 Ink 的输入流：把 process.stdin 的原始字节先经 MouseController
 * 分流（鼠标序列 → 事件，其余 → Ink），同时满足 Ink 对 stdin 的
 * isTTY/setRawMode/ref 要求。
 */
export class MouseAwareStdin extends PassThrough {
  readonly isTTY = true;
  constructor(private readonly mouse: MouseController) {
    super();
  }

  setRawMode(_enabled: boolean): this {
    // raw mode 由 plugin 直接管理 process.stdin
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

/**
 * 接管 process.stdin：设置 raw mode，把数据喂给 MouseController，
 * 剩余字节写入给 Ink 的流。返回清理函数。
 */
export function attachMouseStdin(mouse: MouseController): {
  stdin: MouseAwareStdin;
  dispose: () => void;
} {
  const stdin = new MouseAwareStdin(mouse);
  const onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const rest = mouse.ingest(text);
    if (rest !== "") {
      stdin.write(rest);
    }
  };
  process.stdin.setEncoding("utf8");
  try {
    process.stdin.setRawMode(true);
  } catch {
    /* 非 TTY 时忽略 */
  }
  process.stdin.on("data", onData);
  return {
    stdin,
    dispose: () => {
      process.stdin.removeListener("data", onData);
      // 事件循环：dsh 的 appExit 只设置 process.exitCode，进程退出依赖
      // 事件循环耗尽；stdin 的 flowing 监听会让循环保持活跃，必须暂停。
      try {
        process.stdin.pause();
      } catch {
        /* 忽略 */
      }
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* 忽略 */
      }
    },
  };
}
