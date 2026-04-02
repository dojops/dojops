import * as fs from "node:fs";

interface CacheEntry {
  content: string;
  mtime: number;
  /** Monotonic timestamp for LRU ordering. */
  lastAccess: number;
}

export interface FileCacheStats {
  hits: number;
  misses: number;
  entries: number;
}

/**
 * In-memory file state cache with LRU eviction.
 * Avoids re-reading unchanged files during agent tool invocations.
 * On get(), the cached mtime is compared against the file on disk —
 * stale entries are evicted automatically.
 */
export class FileStateCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;
  private accessCounter = 0;

  constructor(maxEntries = 100) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  /**
   * Look up a cached file. Returns undefined on miss or when the
   * on-disk mtime no longer matches the cached value (stale).
   */
  get(filePath: string): { content: string; mtime: number } | undefined {
    const entry = this.cache.get(filePath);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Stale check: verify mtime still matches disk
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs !== entry.mtime) {
        // File changed on disk — evict stale entry
        this.cache.delete(filePath);
        this.misses++;
        return undefined;
      }
    } catch {
      // File no longer exists or unreadable — evict
      this.cache.delete(filePath);
      this.misses++;
      return undefined;
    }

    entry.lastAccess = ++this.accessCounter;
    this.hits++;
    return { content: entry.content, mtime: entry.mtime };
  }

  /** Insert or update a cache entry. Evicts the LRU entry when at capacity. */
  set(filePath: string, content: string, mtime: number): void {
    // If the key already exists, update in place (no eviction needed)
    if (this.cache.has(filePath)) {
      this.cache.set(filePath, {
        content,
        mtime,
        lastAccess: ++this.accessCounter,
      });
      return;
    }

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(filePath, {
      content,
      mtime,
      lastAccess: ++this.accessCounter,
    });
  }

  /** Invalidate a single path (call after writes). */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /** Clear the entire cache. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Check whether a path has a cache entry (does not verify staleness). */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /** Return hit/miss/entry counters. */
  getStats(): FileCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
    };
  }

  /** Evict the entry with the lowest lastAccess value. */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.cache.delete(oldestKey);
    }
  }
}
