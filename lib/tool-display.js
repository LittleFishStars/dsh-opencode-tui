/**
 * 工具展示：opencode 风格的工具名/进行中文案/参数摘要。
 *
 * 从 projection.ts 拆出（独立于会话投影的纯展示逻辑）。
 */
import { truncate } from "./util.js";
/** 工具展示名（opencode 风格：Bash / Read / Edit ...）。 */
export function toolDisplayName(name) {
    const map = {
        bash: "Bash",
        pwsh: "Pwsh",
        fs_read: "Read",
        fs_write: "Write",
        fs_edit: "Edit",
        fs_search: "Search",
        fs_list: "List",
        fs_glob: "Glob",
        grep: "Grep",
        web_search: "Web Search",
        web_fetch: "Fetch",
        todo: "Todo",
        goal: "Goal",
        skill: "Skill",
        subagent: "Task",
        subagent_fork: "Task",
        workflow: "Workflow",
        ralph: "Ralph",
        ask_user: "Ask",
        ask_user_question: "Ask",
        plan_mode: "Plan",
        compact: "Compact",
        jobs: "Jobs",
        bash_persistent: "Bash",
        str_replace_editor: "Edit",
        ls: "List",
        view: "View",
        glob: "Glob",
        write: "Write",
        edit: "Edit",
        fetch: "Fetch",
        patch: "Patch",
    };
    if (name in map)
        return map[name];
    // 去掉常见前缀后驼峰化
    const cleaned = name.replace(/^tool_/, "").replace(/^dsh_/, "");
    return cleaned
        .split(/[_-]/)
        .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");
}
/** 工具进行中的动作文案（opencode 风格）。 */
export function toolAction(name) {
    const map = {
        bash: "Building command...",
        pwsh: "Building command...",
        fs_read: "Reading file...",
        fs_write: "Preparing write...",
        fs_edit: "Preparing edit...",
        fs_search: "Searching content...",
        fs_list: "Listing directory...",
        fs_glob: "Finding files...",
        web_search: "Searching web...",
        web_fetch: "Writing fetch...",
        todo: "Updating todos...",
        goal: "Updating goal...",
        subagent: "Preparing prompt...",
        workflow: "Running workflow...",
        ralph: "Running ralph loop...",
        ask_user: "Asking you...",
        ask_user_question: "Asking you...",
        bash_persistent: "Building command...",
        ls: "Listing directory...",
        view: "Reading file...",
        glob: "Finding files...",
        grep: "Searching content...",
        write: "Preparing write...",
        edit: "Preparing edit...",
        fetch: "Writing fetch...",
        patch: "Preparing patch...",
    };
    return map[name] ?? "Working...";
}
/** 解析工具参数 JSON → 展示摘要（opencode 风格：主参数 + 键值对）。 */
export function toolParamSummary(name, argsJson, maxWidth) {
    let input;
    try {
        input = JSON.parse(argsJson || "{}");
    }
    catch {
        return compactParam(argsJson.replace(/\n/g, " "), maxWidth);
    }
    if (typeof input !== "object" || input === null)
        return compactParam(argsJson.replace(/\n/g, " "), maxWidth);
    const obj = input;
    // 主参数：不同工具取不同字段
    const mainKey = name === "bash" || name === "bash_persistent"
        ? "command"
        : name === "fs_read" || name === "fs_write" || name === "fs_edit"
            ? "path"
            : name === "view" || name === "write" || name === "edit"
                ? "file_path"
                : name === "web_fetch" || name === "fetch"
                    ? "url"
                    : name === "grep" || name === "fs_search"
                        ? "pattern"
                        : name === "subagent" || name === "subagent_fork"
                            ? "prompt"
                            : name === "glob" || name === "fs_glob"
                                ? "pattern"
                                : name === "web_search"
                                    ? "query"
                                    : name === "ls" || name === "fs_list"
                                        ? "path"
                                        : name === "todo"
                                            ? "todos"
                                            : name === "ask_user" || name === "ask_user_question"
                                                ? "question"
                                                : "input";
    const main = obj[mainKey];
    const mainText = typeof main === "string" ? main.replace(/\n/g, " ") : typeof main === "number" ? String(main) : "";
    // 附加键值
    const pairs = [];
    for (const [k, v] of Object.entries(obj)) {
        if (k === mainKey)
            continue;
        if (v === undefined || v === null || v === "")
            continue;
        const vText = typeof v === "object" ? JSON.stringify(v) : String(v);
        if (vText === "{}" || vText === "[]")
            continue;
        pairs.push(`${k}=${vText.replace(/\n/g, " ")}`);
    }
    if (pairs.length > 0) {
        const joined = `${mainText} (${pairs.join(", ")})`;
        return compactParam(joined, maxWidth);
    }
    return compactParam(mainText, maxWidth);
}
function compactParam(text, maxWidth) {
    if (text === "")
        return "";
    // 保留 maxWidth 的宽度
    return truncateForWidth(text, maxWidth);
}
function truncateForWidth(text, maxWidth) {
    if (maxWidth <= 0)
        return "";
    return truncate(text, maxWidth);
}
/** 从结果文本里提取语法高亮语言标签（opencode 风格代码块）。 */
export function extOfPath(path) {
    const ext = path.split(".").pop();
    if (!ext || ext === path)
        return "";
    return ext.toLowerCase();
}
//# sourceMappingURL=tool-display.js.map