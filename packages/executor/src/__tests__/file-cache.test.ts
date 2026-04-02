import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileStateCache } from "../file-cache";

describe("FileStateCache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-cache-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper: write a file and return its mtime. */
  function writeAndStat(name: string, content: string): { filePath: string; mtime: number } {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, "utf-8");
    const stat = fs.statSync(filePath);
    return { filePath, mtime: stat.mtimeMs };
  }

  describe("get/set basics", () => {
    it("returns undefined for a path never cached", () => {
      const cache = new FileStateCache();
      const { filePath } = writeAndStat("a.txt", "hello");
      expect(cache.get(filePath)).toBeUndefined();
    });

    it("returns cached content on hit", () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("b.txt", "world");
      cache.set(filePath, "world", mtime);

      const result = cache.get(filePath);
      expect(result).toBeDefined();
      expect(result!.content).toBe("world");
      expect(result!.mtime).toBe(mtime);
    });
  });

  describe("stats tracking", () => {
    it("tracks hits and misses", () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("stats.txt", "data");
      cache.set(filePath, "data", mtime);

      // Miss
      cache.get(path.join(tmpDir, "nonexistent.txt"));
      // Hit
      cache.get(filePath);
      // Hit
      cache.get(filePath);

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.entries).toBe(1);
    });
  });

  describe("invalidation", () => {
    it("invalidate() removes a single entry", () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("inv.txt", "x");
      cache.set(filePath, "x", mtime);
      expect(cache.has(filePath)).toBe(true);

      cache.invalidate(filePath);
      expect(cache.has(filePath)).toBe(false);
      expect(cache.get(filePath)).toBeUndefined();
    });

    it("invalidateAll() clears every entry", () => {
      const cache = new FileStateCache();
      const a = writeAndStat("a.txt", "aa");
      const b = writeAndStat("b.txt", "bb");
      cache.set(a.filePath, "aa", a.mtime);
      cache.set(b.filePath, "bb", b.mtime);

      expect(cache.getStats().entries).toBe(2);
      cache.invalidateAll();
      expect(cache.getStats().entries).toBe(0);
    });
  });

  describe("stale mtime detection", () => {
    it("returns undefined when file mtime changed on disk", async () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("stale.txt", "original");
      cache.set(filePath, "original", mtime);

      // Mutate the file on disk so mtime changes
      // Use a short delay to guarantee a different mtime
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.writeFileSync(filePath, "modified", "utf-8");

      const result = cache.get(filePath);
      expect(result).toBeUndefined();
    });

    it("returns undefined when file is deleted from disk", () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("gone.txt", "bye");
      cache.set(filePath, "bye", mtime);

      fs.unlinkSync(filePath);

      const result = cache.get(filePath);
      expect(result).toBeUndefined();
    });

    it("counts stale checks as misses", async () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("countme.txt", "v1");
      cache.set(filePath, "v1", mtime);

      // Mutate so the cached entry becomes stale
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.writeFileSync(filePath, "v2", "utf-8");

      cache.get(filePath);
      expect(cache.getStats().misses).toBe(1);
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least recently used entry when at capacity", () => {
      const cache = new FileStateCache(3);
      const files = [
        writeAndStat("lru1.txt", "1"),
        writeAndStat("lru2.txt", "2"),
        writeAndStat("lru3.txt", "3"),
      ];

      cache.set(files[0].filePath, "1", files[0].mtime);
      cache.set(files[1].filePath, "2", files[1].mtime);
      cache.set(files[2].filePath, "3", files[2].mtime);

      // Access file 1 so file 2 becomes the LRU
      cache.get(files[0].filePath);

      // Insert a 4th entry — should evict file 2 (LRU)
      const file4 = writeAndStat("lru4.txt", "4");
      cache.set(file4.filePath, "4", file4.mtime);

      expect(cache.getStats().entries).toBe(3);
      expect(cache.has(files[1].filePath)).toBe(false); // evicted
      expect(cache.has(files[0].filePath)).toBe(true); // recently accessed
      expect(cache.has(files[2].filePath)).toBe(true); // newer than file 2
      expect(cache.has(file4.filePath)).toBe(true); // just inserted
    });

    it("respects maxEntries of 1", () => {
      const cache = new FileStateCache(1);
      const a = writeAndStat("solo1.txt", "a");
      const b = writeAndStat("solo2.txt", "b");

      cache.set(a.filePath, "a", a.mtime);
      cache.set(b.filePath, "b", b.mtime);

      expect(cache.getStats().entries).toBe(1);
      expect(cache.has(a.filePath)).toBe(false);
      expect(cache.has(b.filePath)).toBe(true);
    });

    it("does not evict when updating an existing key", () => {
      const cache = new FileStateCache(2);
      const a = writeAndStat("up1.txt", "a");
      const b = writeAndStat("up2.txt", "b");

      cache.set(a.filePath, "a", a.mtime);
      cache.set(b.filePath, "b", b.mtime);

      // Update a — should NOT evict b
      cache.set(a.filePath, "a-updated", a.mtime);

      expect(cache.getStats().entries).toBe(2);
      expect(cache.has(b.filePath)).toBe(true);
    });
  });

  describe("has()", () => {
    it("returns false for uncached paths", () => {
      const cache = new FileStateCache();
      expect(cache.has("/nonexistent/path.txt")).toBe(false);
    });

    it("returns true for cached paths (without verifying staleness)", () => {
      const cache = new FileStateCache();
      const { filePath, mtime } = writeAndStat("hascheck.txt", "ok");
      cache.set(filePath, "ok", mtime);
      expect(cache.has(filePath)).toBe(true);
    });
  });
});
