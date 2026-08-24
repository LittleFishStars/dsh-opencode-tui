/** 会话标题缓存 + 当前活跃会话持久化。 */
export declare class SessionTitleCache {
    private map;
    private currentMap;
    private loaded;
    /** 从磁盘加载缓存。 */
    load(): void;
    /** 保存缓存到磁盘。 */
    save(): void;
    /** 获取缓存的标题（无缓存返回 undefined）。 */
    get(dshId: string): string | undefined;
    /** 设置缓存标题。 */
    set(dshId: string, title: string, mtime: number): void;
    /** 获取所有已缓存的会话 id。 */
    keys(): string[];
    /** 清理过期缓存：移除已不存在于文件系统的会话。 */
    cleanup(existingIds: Set<string>): void;
    /** 获取当前目录活跃的 DSH 会话 id。 */
    getCurrent(directory: string): string | undefined;
    /** 设置当前目录活跃的 DSH 会话 id。 */
    setCurrent(directory: string, dshSessionId: string): void;
    /** 清除当前目录活跃会话。 */
    clearCurrent(directory: string): void;
}
