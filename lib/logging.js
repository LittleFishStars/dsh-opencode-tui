/**
 * 兼容层日志：写文件（终端保持干净；请求级日志需 DSH_OC_DEBUG=1）。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const ocLogDir = () => {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    return join(dshHome, "logs");
};
export function ocLog(message) {
    try {
        mkdirSync(ocLogDir(), { recursive: true });
        appendFileSync(join(ocLogDir(), "oc-server.log"), `${new Date().toISOString()} ${message}\n`);
    }
    catch {
        /* 日志失败不影响主流程 */
    }
}
//# sourceMappingURL=logging.js.map