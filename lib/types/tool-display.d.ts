/** 工具展示名（opencode 风格：Bash / Read / Edit ...）。 */
export declare function toolDisplayName(name: string): string;
/** 工具进行中的动作文案（opencode 风格）。 */
export declare function toolAction(name: string): string;
/** 解析工具参数 JSON → 展示摘要（opencode 风格：主参数 + 键值对）。 */
export declare function toolParamSummary(name: string, argsJson: string, maxWidth: number): string;
/** 从结果文本里提取语法高亮语言标签（opencode 风格代码块）。 */
export declare function extOfPath(path: string): string;
