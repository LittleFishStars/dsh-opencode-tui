/**
 * v2 路由（/api/*）：OcServer 的 handleApi 拆分。
 *
 * 通过 RouterContext 访问会话存储、模型目录与消息发送能力，
 * 不直接持有 OcServer（低耦合，便于单独测试）。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type LegacyModel } from "../oc-proto.js";
import type { RouterContext } from "./context.js";
export declare function handleApi(ctx: RouterContext, path: string, method: string, body: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean>;
export type { LegacyModel };
