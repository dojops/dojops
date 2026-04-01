import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemoryStore, MemoryScanner, toMemoryId, type MemoryEntry } from "../persistent-memory";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-memory-test-"));
}

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: "test-memory",
    name: "Test Memory",
    description: "A test memory entry",
    type: "project",
    updatedAt: "2026-01-15T10:00:00.000Z",
    content: "This project uses Pulumi, not Terraform.",
    ...overrides,
  };
}

describe("MemoryStore", () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new MemoryStore({ baseDir: tmpDir, projectId: "my-project" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("save and load", () => {
    it("saves and loads a memory entry", () => {
      const entry = makeEntry();
      store.save(entry);

      const loaded = store.load("test-memory");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("test-memory");
      expect(loaded!.name).toBe("Test Memory");
      expect(loaded!.description).toBe("A test memory entry");
      expect(loaded!.type).toBe("project");
      expect(loaded!.content).toBe("This project uses Pulumi, not Terraform.");
    });

    it("returns null for non-existent memory", () => {
      expect(store.load("nonexistent")).toBeNull();
    });

    it("overwrites existing memory with same id", () => {
      store.save(makeEntry({ content: "v1" }));
      store.save(makeEntry({ content: "v2" }));

      const loaded = store.load("test-memory");
      expect(loaded!.content).toBe("v2");
    });

    it("creates memory directory if missing", () => {
      expect(fs.existsSync(store.memoryDir)).toBe(false);
      store.save(makeEntry());
      expect(fs.existsSync(store.memoryDir)).toBe(true);
    });

    it("preserves multiline content", () => {
      const entry = makeEntry({
        content: "Line 1\n\nLine 2\n- bullet\n- another",
      });
      store.save(entry);
      const loaded = store.load("test-memory");
      expect(loaded!.content).toBe("Line 1\n\nLine 2\n- bullet\n- another");
    });
  });

  describe("delete", () => {
    it("deletes an existing memory", () => {
      store.save(makeEntry());
      expect(store.delete("test-memory")).toBe(true);
      expect(store.load("test-memory")).toBeNull();
    });

    it("returns false for non-existent memory", () => {
      expect(store.delete("nope")).toBe(false);
    });

    it("updates index after deletion", () => {
      store.save(makeEntry());
      store.delete("test-memory");
      const index = store.readIndex();
      expect(index).not.toContain("test-memory");
    });
  });

  describe("list", () => {
    it("returns empty array when no memories exist", () => {
      expect(store.list()).toEqual([]);
    });

    it("lists all saved memories", () => {
      store.save(makeEntry({ id: "a", name: "A", updatedAt: "2026-01-01T00:00:00Z" }));
      store.save(makeEntry({ id: "b", name: "B", updatedAt: "2026-01-02T00:00:00Z" }));
      store.save(makeEntry({ id: "c", name: "C", updatedAt: "2026-01-03T00:00:00Z" }));

      const entries = store.list();
      expect(entries).toHaveLength(3);
      // Sorted by updatedAt descending
      expect(entries[0].id).toBe("c");
      expect(entries[1].id).toBe("b");
      expect(entries[2].id).toBe("a");
    });

    it("excludes MEMORY.md from listings", () => {
      store.save(makeEntry());
      const entries = store.list();
      expect(entries.every((e) => e.id !== "MEMORY")).toBe(true);
    });
  });

  describe("listByType", () => {
    it("filters by memory type", () => {
      store.save(makeEntry({ id: "u1", type: "user" }));
      store.save(makeEntry({ id: "f1", type: "feedback" }));
      store.save(makeEntry({ id: "p1", type: "project" }));
      store.save(makeEntry({ id: "p2", type: "project" }));

      expect(store.listByType("project")).toHaveLength(2);
      expect(store.listByType("user")).toHaveLength(1);
      expect(store.listByType("reference")).toHaveLength(0);
    });
  });

  describe("MEMORY.md index", () => {
    it("creates index on first save", () => {
      store.save(makeEntry());
      const index = store.readIndex();
      expect(index).toContain("# Memory Index");
      expect(index).toContain("Test Memory");
      expect(index).toContain("test-memory.md");
    });

    it("groups entries by type", () => {
      store.save(makeEntry({ id: "u1", name: "User pref", type: "user" }));
      store.save(makeEntry({ id: "f1", name: "Feedback note", type: "feedback" }));
      store.save(makeEntry({ id: "p1", name: "Project info", type: "project" }));

      const index = store.readIndex();
      expect(index).toContain("## user");
      expect(index).toContain("## feedback");
      expect(index).toContain("## project");
    });

    it("returns empty string when no index exists", () => {
      expect(store.readIndex()).toBe("");
    });

    it("rebuilds index on delete", () => {
      store.save(makeEntry({ id: "a", name: "A" }));
      store.save(makeEntry({ id: "b", name: "B" }));
      store.delete("a");

      const index = store.readIndex();
      expect(index).not.toContain("[A]");
      expect(index).toContain("[B]");
    });

    it("truncates index to maxIndexLines", () => {
      const store2 = new MemoryStore({
        baseDir: tmpDir,
        projectId: "small-index",
        maxIndexLines: 5,
      });
      for (let i = 0; i < 20; i++) {
        store2.save(makeEntry({ id: `m${i}`, name: `Memory ${i}` }));
      }
      const index = store2.readIndex();
      const lines = index.split("\n");
      expect(lines.length).toBeLessThanOrEqual(5);
    });
  });

  describe("project hashing", () => {
    it("different projects get different directories", () => {
      const store1 = new MemoryStore({ baseDir: tmpDir, projectId: "project-a" });
      const store2 = new MemoryStore({ baseDir: tmpDir, projectId: "project-b" });
      expect(store1.memoryDir).not.toBe(store2.memoryDir);
    });

    it("same project gets same directory", () => {
      const store1 = new MemoryStore({ baseDir: tmpDir, projectId: "same" });
      const store2 = new MemoryStore({ baseDir: tmpDir, projectId: "same" });
      expect(store1.memoryDir).toBe(store2.memoryDir);
    });
  });

  describe("malformed files", () => {
    it("skips files without frontmatter", () => {
      store.save(makeEntry());
      // Overwrite with bad content
      fs.writeFileSync(path.join(store.memoryDir, "test-memory.md"), "No frontmatter here");
      expect(store.load("test-memory")).toBeNull();
    });

    it("skips files missing required fields", () => {
      store.save(makeEntry());
      fs.writeFileSync(
        path.join(store.memoryDir, "test-memory.md"),
        "---\ndescription: missing name and type\n---\ncontent",
      );
      expect(store.load("test-memory")).toBeNull();
    });
  });
});

describe("MemoryScanner", () => {
  let tmpDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new MemoryStore({ baseDir: tmpDir, projectId: "scan-test" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty for empty store", async () => {
    const scanner = new MemoryScanner({
      generate: vi.fn(),
    });
    const results = await scanner.scan(store, "anything");
    expect(results).toEqual([]);
  });

  it("returns all entries when fewer than topK", async () => {
    store.save(makeEntry({ id: "a", name: "A" }));
    store.save(makeEntry({ id: "b", name: "B" }));

    const scanner = new MemoryScanner({
      generate: vi.fn(),
      topK: 5,
    });
    const results = await scanner.scan(store, "context");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });

  it("uses LLM to rank when more entries than topK", async () => {
    for (let i = 0; i < 10; i++) {
      store.save(
        makeEntry({
          id: `m${i}`,
          name: `Memory ${i}`,
          updatedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        }),
      );
    }

    const generate = vi.fn().mockResolvedValue("[3, 7, 1]");
    const scanner = new MemoryScanner({ generate, topK: 3 });
    const results = await scanner.scan(store, "test context");

    expect(generate).toHaveBeenCalledOnce();
    expect(results).toHaveLength(3);
    // First result should have highest score
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[1].score).toBeGreaterThan(results[2].score);
  });

  it("falls back to recency on LLM failure", async () => {
    for (let i = 0; i < 8; i++) {
      store.save(
        makeEntry({
          id: `m${i}`,
          name: `Memory ${i}`,
          updatedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        }),
      );
    }

    const generate = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const scanner = new MemoryScanner({ generate, topK: 3 });
    const results = await scanner.scan(store, "context");

    expect(results).toHaveLength(3);
    // Should be most recent first (list() sorts descending by updatedAt)
    expect(results[0].entry.id).toBe("m7");
  });

  it("handles LLM returning markdown-wrapped JSON", async () => {
    for (let i = 0; i < 6; i++) {
      store.save(makeEntry({ id: `m${i}`, name: `M${i}` }));
    }

    const generate = vi.fn().mockResolvedValue("```json\n[0, 2, 4]\n```");
    const scanner = new MemoryScanner({ generate, topK: 3 });
    const results = await scanner.scan(store, "context");

    expect(results).toHaveLength(3);
  });

  it("filters out-of-range indices from LLM response", async () => {
    for (let i = 0; i < 6; i++) {
      store.save(makeEntry({ id: `m${i}`, name: `M${i}` }));
    }

    const generate = vi.fn().mockResolvedValue("[0, 99, -1, 2]");
    const scanner = new MemoryScanner({ generate, topK: 3 });
    const results = await scanner.scan(store, "context");

    // Only 0 and 2 are valid
    expect(results).toHaveLength(2);
  });
});

describe("toMemoryId", () => {
  it("converts name to slug", () => {
    expect(toMemoryId("User Role")).toBe("user-role");
  });

  it("handles special characters", () => {
    expect(toMemoryId("Project: CI/CD Setup!")).toBe("project-ci-cd-setup");
  });

  it("trims leading/trailing hyphens", () => {
    expect(toMemoryId("---hello---")).toBe("hello");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(toMemoryId(long).length).toBe(60);
  });

  it("lowercases everything", () => {
    expect(toMemoryId("UPPERCASE")).toBe("uppercase");
  });
});
