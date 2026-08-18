/**
 * 会话标题缓存：将解压提取的标题持久化到 JSON 文件，
 * 避免每次 listSessions 都解压 26 个大会话（30MB+）。
 *
 * 缓存文件：<DSH_HOME>/session-titles.json
 * 结构：{ "<dshId>": { "title": "...", "updatedAt": 1234567890 } }
 *
 * 启动时加载缓存 + 扫描文件系统补全新会话的标题。
 * listSessions 直接从缓存读取（毫秒级响应）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** 缓存文件内的单条标题记录。 */
interface TitleEntry {
  title: string;
  /** 会话文件的 mtime（用于判断缓存是否过期） */
  mtime: number;
}

/** 缓存文件整体结构。 */
interface CacheFile {
  version: number;
  titles: Record<string, TitleEntry>;
}

const CACHE_VERSION = 1;

/** 解析缓存文件路径：<DSH_HOME>/session-titles.json。 */
function cacheFilePath(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(dshHome, "session-titles.json");
}

/** 会话标题缓存：内存 + 持久化。 */
export class SessionTitleCache {
  private map = new Map<string, TitleEntry>();
  private loaded = false;

  /** 从磁盘加载缓存。 */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const path = cacheFilePath();
      if (!existsSync(path)) return;
      const raw = readFileSync(path, "utf-8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version !== CACHE_VERSION) return;
      for (const [id, entry] of Object.entries(parsed.titles ?? {})) {
        this.map.set(id, entry);
      }
    } catch {
      /* 缓存损坏时忽略，重新建立 */
    }
  }

  /** 保存缓存到磁盘。 */
  save(): void {
    try {
      const path = cacheFilePath();
      mkdirSync(join(path, ".."), { recursive: true });
      const data: CacheFile = {
        version: CACHE_VERSION,
        titles: Object.fromEntries(this.map),
      };
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      /* 写入失败不影响功能 */
    }
  }

  /** 获取缓存的标题（无缓存或过期返回 undefined）。 */
  get(dshId: string, mtime: number): string | undefined {
    const entry = this.map.get(dshId);
    if (!entry) return undefined;
    // mtime 不匹配说明文件已更新，缓存过期
    if (entry.mtime !== mtime) return undefined;
    return entry.title;
  }

  /** 设置缓存标题。 */
  set(dshId: string, title: string, mtime: number): void {
    this.map.set(dshId, { title, mtime });
  }

  /** 获取所有已缓存的会话 id。 */
  keys(): string[] {
    return [...this.map.keys()];
  }

  /** 清理过期缓存：移除已不存在于文件系统的会话。 */
  cleanup(existingIds: Set<string>): void {
    let removed = 0;
    for (const id of this.map.keys()) {
      if (!existingIds.has(id)) {
        this.map.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.save();
  }
}
