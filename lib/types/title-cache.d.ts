/** 会话标题缓存：内存 + 持久化。 */
export declare class SessionTitleCache {
    private map;
    private loaded;
    /** 从磁盘加载缓存。 */
    load(): void;
    /** 保存缓存到磁盘。 */
    save(): void;
    /** 获取缓存的标题（无缓存或过期返回 undefined）。 */
    get(dshId: string, mtime: number): string | undefined;
    /** 设置缓存标题。 */
    set(dshId: string, title: string, mtime: number): void;
    /** 获取所有已缓存的会话 id。 */
    keys(): string[];
}
