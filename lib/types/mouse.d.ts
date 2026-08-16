/**
 * 鼠标支持：SGR 鼠标协议（\x1b[<b;x;yM/m）解析 + 输入分流。
 *
 * Ink 的按键解析器不认识鼠标序列，所以这里在 process.stdin 与 Ink 之间
 * 插入一个分流层：鼠标序列被解析为 MouseEvent 事件，其余字节透传给 Ink。
 *
 * 终端模式：?1000h（点击/释放/滚轮）+ ?1006h（SGR 扩展坐标）。
 */
import { PassThrough } from "node:stream";
export type MouseEventData = {
    type: "mousedown";
    button: number;
    x: number;
    y: number;
} | {
    type: "mouseup";
    button: number;
    x: number;
    y: number;
} | {
    type: "wheel";
    /** +1 向下滚（内容向上），-1 向上滚 */
    dx: number;
    x: number;
    y: number;
};
export declare class MouseController {
    private buffer;
    private listeners;
    /** 是否已启用终端鼠标模式 */
    enabled: boolean;
    on(listener: (e: MouseEventData) => void): () => void;
    emit(event: MouseEventData): void;
    /**
     * 吞掉 chunk 里的鼠标序列，返回应透传给 Ink 的剩余字节。
     * 支持跨 chunk 的序列（内部缓冲）。
     */
    ingest(chunk: string): string;
    private handleSgr;
    /** 启用终端鼠标模式（应写入 stdout）。 */
    enable(): void;
    /** 禁用终端鼠标模式。 */
    disable(): void;
}
export declare const MOUSE_ENABLE_SEQUENCE = "\u001B[?1000h\u001B[?1006h";
export declare const MOUSE_DISABLE_SEQUENCE = "\u001B[?1000l\u001B[?1006l";
/**
 * 传给 Ink 的输入流：把 process.stdin 的原始字节先经 MouseController
 * 分流（鼠标序列 → 事件，其余 → Ink），同时满足 Ink 对 stdin 的
 * isTTY/setRawMode/ref 要求。
 */
export declare class MouseAwareStdin extends PassThrough {
    private readonly mouse;
    readonly isTTY = true;
    constructor(mouse: MouseController);
    setRawMode(_enabled: boolean): this;
    ref(): this;
    unref(): this;
}
/**
 * 接管 process.stdin：设置 raw mode，把数据喂给 MouseController，
 * 剩余字节写入给 Ink 的流。返回清理函数。
 */
export declare function attachMouseStdin(mouse: MouseController): {
    stdin: MouseAwareStdin;
    dispose: () => void;
};
