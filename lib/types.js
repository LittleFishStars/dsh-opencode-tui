// ── agent / 权限 ──────────────────────────────────────────────────────────
/** TUI agent 名 → DSH permission preset。 */
export const PERMISSION_AGENTS = {
    "read-only": "read-only",
    "workspace-write": "workspace-write",
    "full-access": "danger-full-access",
};
export const DEFAULT_AGENT = "workspace-write";
export const AGENT_DESCRIPTIONS = {
    "read-only": "Read-only sandbox: reads and searches allowed, writes require approval",
    "workspace-write": "Write inside the workspace; wider retries require approval",
    "full-access": "Full file access without approval prompts",
};
/** DSH preset 名 → TUI agent 名（未知/缺失回退默认）。 */
export function agentOfPreset(preset) {
    if (preset) {
        for (const [agent, p] of Object.entries(PERMISSION_AGENTS)) {
            if (p === preset)
                return agent;
        }
    }
    return DEFAULT_AGENT;
}
// ── 文件工具 ───────────────────────────────────────────────────────────────
/** 文件修改类工具：arguments 里通常带 path/filePath/file 字段。 */
export const FILE_TOOL_NAMES = new Set([
    "write",
    "edit",
    "rename",
    "move",
    "delete",
    "remove",
    "copy",
    "fs_write",
    "fs_edit",
    "fs_rename",
    "fs_move",
    "fs_delete",
    "fs_remove",
    "fs_copy",
    "str-replace-editor",
]);
//# sourceMappingURL=types.js.map