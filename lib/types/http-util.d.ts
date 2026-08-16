/**
 * HTTP 工具：JSON 响应、SSE 头、请求体读取、宽松 JSON 解析。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export declare function sseHeaders(res: ServerResponse): void;
/** 宽松 JSON 解析：失败返回空对象（请求体可选/容错）。 */
export declare function safeParse(text: string): Record<string, unknown>;
export declare function readBody(req: IncomingMessage): Promise<string>;
