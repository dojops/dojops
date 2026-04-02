import { describe, it, expect, beforeEach } from "vitest";
import { FileHistory, DEFAULT_MAX_DEPTH } from "../file-history";

describe("FileHistory", () => {
  let history: FileHistory;

  beforeEach(() => {
    history = new FileHistory();
  });

  // ── Basic record / undo / redo cycle ─────────────────────────────

  describe("record → undo → redo cycle", () => {
    it("records a change and allows undo back to original content", () => {
      history.record("/a.ts", "before", "after");

      expect(history.canUndo("/a.ts")).toBe(true);
      expect(history.canRedo("/a.ts")).toBe(false);

      const undone = history.undo("/a.ts");
      expect(undone).toBe("before");
      expect(history.canUndo("/a.ts")).toBe(false);
      expect(history.canRedo("/a.ts")).toBe(true);
    });

    it("redo restores the content after undo", () => {
      history.record("/a.ts", "v0", "v1");

      history.undo("/a.ts");
      const redone = history.redo("/a.ts");
      expect(redone).toBe("v1");
      expect(history.canRedo("/a.ts")).toBe(false);
    });

    it("supports multiple undo/redo steps", () => {
      history.record("/a.ts", "v0", "v1");
      history.record("/a.ts", "v1", "v2");
      history.record("/a.ts", "v2", "v3");

      expect(history.undo("/a.ts")).toBe("v2");
      expect(history.undo("/a.ts")).toBe("v1");
      expect(history.undo("/a.ts")).toBe("v0");
      expect(history.canUndo("/a.ts")).toBe(false);

      expect(history.redo("/a.ts")).toBe("v1");
      expect(history.redo("/a.ts")).toBe("v2");
      expect(history.redo("/a.ts")).toBe("v3");
      expect(history.canRedo("/a.ts")).toBe(false);
    });
  });

  // ── Multiple files tracked independently ─────────────────────────

  describe("multiple files tracked independently", () => {
    it("tracks separate histories for different files", () => {
      history.record("/a.ts", "a-before", "a-after");
      history.record("/b.ts", "b-before", "b-after");

      expect(history.canUndo("/a.ts")).toBe(true);
      expect(history.canUndo("/b.ts")).toBe(true);

      const undoneA = history.undo("/a.ts");
      expect(undoneA).toBe("a-before");
      // /b.ts should still be at head
      expect(history.canUndo("/b.ts")).toBe(true);
      expect(history.canRedo("/b.ts")).toBe(false);
    });

    it("getTrackedFiles returns all tracked paths", () => {
      history.record("/a.ts", "a0", "a1");
      history.record("/b.ts", "b0", "b1");
      history.record("/c.ts", "c0", "c1");

      const tracked = history.getTrackedFiles();
      expect(tracked).toHaveLength(3);
      expect(tracked).toContain("/a.ts");
      expect(tracked).toContain("/b.ts");
      expect(tracked).toContain("/c.ts");
    });
  });

  // ── Redo stack discarded on new change after undo ────────────────

  describe("redo stack discarded on new change after undo", () => {
    it("discards redo entries when a new change is recorded mid-stack", () => {
      history.record("/a.ts", "v0", "v1");
      history.record("/a.ts", "v1", "v2");
      history.record("/a.ts", "v2", "v3");

      // Undo to v1
      history.undo("/a.ts"); // -> v2
      history.undo("/a.ts"); // -> v1

      // Record a new change from v1 — v2 and v3 should be discarded
      history.record("/a.ts", "v1", "v1-alt");

      expect(history.canRedo("/a.ts")).toBe(false);
      expect(history.undo("/a.ts")).toBe("v1");
      expect(history.undo("/a.ts")).toBe("v0");
      expect(history.canUndo("/a.ts")).toBe(false);
    });
  });

  // ── Max depth eviction ───────────────────────────────────────────

  describe("max depth eviction", () => {
    it("evicts oldest entries when exceeding maxDepth", () => {
      const small = new FileHistory(3);

      small.record("/a.ts", "v0", "v1");
      small.record("/a.ts", "v1", "v2");
      small.record("/a.ts", "v2", "v3");
      // 3 changes — at limit
      expect(small.getHistory("/a.ts")).toEqual({ depth: 3, current: 3 });

      // 4th change should evict the oldest
      small.record("/a.ts", "v3", "v4");
      const info = small.getHistory("/a.ts");
      expect(info.depth).toBe(3); // still maxDepth changes

      // Undo all the way — should not reach v0 (it was evicted)
      expect(small.undo("/a.ts")).toBe("v3");
      expect(small.undo("/a.ts")).toBe("v2");
      expect(small.undo("/a.ts")).toBe("v1");
      expect(small.canUndo("/a.ts")).toBe(false);
    });

    it("defaults to DEFAULT_MAX_DEPTH", () => {
      expect(DEFAULT_MAX_DEPTH).toBe(50);
    });

    it("clamps maxDepth to at least 1", () => {
      const tiny = new FileHistory(0);
      tiny.record("/a.ts", "v0", "v1");
      // Should keep at least 1 change
      expect(tiny.getHistory("/a.ts")).toEqual({ depth: 1, current: 1 });
      expect(tiny.canUndo("/a.ts")).toBe(true);
    });
  });

  // ── clear per-file and clear all ─────────────────────────────────

  describe("clear", () => {
    it("clears history for a single file", () => {
      history.record("/a.ts", "a0", "a1");
      history.record("/b.ts", "b0", "b1");

      history.clear("/a.ts");

      expect(history.canUndo("/a.ts")).toBe(false);
      expect(history.canRedo("/a.ts")).toBe(false);
      expect(history.getHistory("/a.ts")).toEqual({ depth: 0, current: 0 });
      // /b.ts unaffected
      expect(history.canUndo("/b.ts")).toBe(true);
    });

    it("clears all history when called without arguments", () => {
      history.record("/a.ts", "a0", "a1");
      history.record("/b.ts", "b0", "b1");

      history.clear();

      expect(history.getTrackedFiles()).toEqual([]);
      expect(history.canUndo("/a.ts")).toBe(false);
      expect(history.canUndo("/b.ts")).toBe(false);
    });
  });

  // ── canUndo / canRedo states ─────────────────────────────────────

  describe("canUndo / canRedo states", () => {
    it("canUndo and canRedo are both false for untracked file", () => {
      expect(history.canUndo("/unknown.ts")).toBe(false);
      expect(history.canRedo("/unknown.ts")).toBe(false);
    });

    it("canUndo is true after record, canRedo is false", () => {
      history.record("/a.ts", "v0", "v1");
      expect(history.canUndo("/a.ts")).toBe(true);
      expect(history.canRedo("/a.ts")).toBe(false);
    });

    it("canUndo is false after undoing all, canRedo is true", () => {
      history.record("/a.ts", "v0", "v1");
      history.undo("/a.ts");
      expect(history.canUndo("/a.ts")).toBe(false);
      expect(history.canRedo("/a.ts")).toBe(true);
    });

    it("canRedo becomes false after redoing all", () => {
      history.record("/a.ts", "v0", "v1");
      history.undo("/a.ts");
      history.redo("/a.ts");
      expect(history.canUndo("/a.ts")).toBe(true);
      expect(history.canRedo("/a.ts")).toBe(false);
    });
  });

  // ── getHistory returns correct depth / position ──────────────────

  describe("getHistory", () => {
    it("returns depth 0 and current 0 for untracked file", () => {
      expect(history.getHistory("/x.ts")).toEqual({ depth: 0, current: 0 });
    });

    it("returns correct depth and current after recording", () => {
      history.record("/a.ts", "v0", "v1");
      expect(history.getHistory("/a.ts")).toEqual({ depth: 1, current: 1 });

      history.record("/a.ts", "v1", "v2");
      expect(history.getHistory("/a.ts")).toEqual({ depth: 2, current: 2 });
    });

    it("current moves back on undo and forward on redo", () => {
      history.record("/a.ts", "v0", "v1");
      history.record("/a.ts", "v1", "v2");

      history.undo("/a.ts");
      expect(history.getHistory("/a.ts")).toEqual({ depth: 2, current: 1 });

      history.redo("/a.ts");
      expect(history.getHistory("/a.ts")).toEqual({ depth: 2, current: 2 });
    });

    it("depth shrinks when recording after undo (redo stack discarded)", () => {
      history.record("/a.ts", "v0", "v1");
      history.record("/a.ts", "v1", "v2");
      history.record("/a.ts", "v2", "v3");

      history.undo("/a.ts"); // cursor at 2
      history.undo("/a.ts"); // cursor at 1

      history.record("/a.ts", "v1", "v1-new");
      // v2 and v3 discarded, now: [v0, v1, v1-new] => depth 2, current 2
      expect(history.getHistory("/a.ts")).toEqual({ depth: 2, current: 2 });
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("undo returns undefined when history is empty", () => {
      expect(history.undo("/x.ts")).toBeUndefined();
    });

    it("redo returns undefined when at head", () => {
      history.record("/a.ts", "v0", "v1");
      expect(history.redo("/a.ts")).toBeUndefined();
    });

    it("undo returns undefined when already fully undone", () => {
      history.record("/a.ts", "v0", "v1");
      history.undo("/a.ts");
      expect(history.undo("/a.ts")).toBeUndefined();
    });

    it("redo returns undefined for untracked file", () => {
      expect(history.redo("/x.ts")).toBeUndefined();
    });

    it("recording with identical before/after still tracks the change", () => {
      history.record("/a.ts", "same", "same");
      expect(history.getHistory("/a.ts")).toEqual({ depth: 1, current: 1 });
      expect(history.canUndo("/a.ts")).toBe(true);
    });

    it("clear on untracked file is a no-op", () => {
      // Should not throw
      history.clear("/nonexistent.ts");
      expect(history.getTrackedFiles()).toEqual([]);
    });
  });
});
