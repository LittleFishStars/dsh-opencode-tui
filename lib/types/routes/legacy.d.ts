/**
 * 旧协议路由（/session/:id/* 与杂项旧路径）：OcServer 的
 * handleLegacySession + handle 拆分。
 *
 * 通过 RouterContext 访问会话存储与消息发送能力。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type ModelRef } from "../oc-proto.js";
import type { RouterContext } from "./context.js";
/** 旧协议 /session/:id/* 子路由。返回是否已处理。 */
export declare function handleLegacySession(ctx: RouterContext, path: string, method: string, body: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean>;
/** 旧协议杂项路径（/path /project/current /config/providers /session …）。
 *  返回是否已处理。 */
export declare function handleLegacyMisc(ctx: RouterContext, path: string, method: string, body: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export type { ModelRef };
