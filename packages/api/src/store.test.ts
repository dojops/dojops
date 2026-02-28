import { describe, it, expect, beforeEach } from "vitest";
import { HistoryStore } from "./store";

describe("HistoryStore", () => {
  let store: HistoryStore;

  beforeEach(() => {
    store = new HistoryStore();
  });

  it("assigns unique random ids", () => {
    const a = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    const b = store.add({ type: "plan", request: {}, response: {}, durationMs: 20, success: true });
    expect(a.id).toBeDefined();
    expect(b.id).toBeDefined();
    expect(a.id).not.toBe(b.id);
    // IDs should be 12-char hex strings
    expect(a.id).toMatch(/^[a-f0-9]{12}$/);
    expect(b.id).toMatch(/^[a-f0-9]{12}$/);
  });

  it("assigns timestamps on add", () => {
    const entry = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    expect(entry.timestamp).toBeDefined();
    expect(new Date(entry.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("getAll returns entries in reverse-chronological order", () => {
    const a = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    store.add({ type: "plan", request: {}, response: {}, durationMs: 20, success: true });
    const c = store.add({ type: "diff", request: {}, response: {}, durationMs: 30, success: true });

    const all = store.getAll();
    expect(all[0].id).toBe(c.id);
    expect(all[2].id).toBe(a.id);
  });

  it("getAll filters by type", () => {
    store.add({ type: "generate", request: {}, response: {}, durationMs: 10, success: true });
    store.add({ type: "plan", request: {}, response: {}, durationMs: 20, success: true });
    store.add({ type: "generate", request: {}, response: {}, durationMs: 30, success: true });

    const filtered = store.getAll({ type: "generate" });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.type === "generate")).toBe(true);
  });

  it("getAll limits results", () => {
    store.add({ type: "generate", request: {}, response: {}, durationMs: 10, success: true });
    store.add({ type: "generate", request: {}, response: {}, durationMs: 20, success: true });
    store.add({ type: "generate", request: {}, response: {}, durationMs: 30, success: true });

    const limited = store.getAll({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("getById returns matching entry via O(1) lookup", () => {
    const entry = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    const found = store.getById(entry.id);
    expect(found).toBeDefined();
    expect(found!.type).toBe("generate");
    expect(found!.id).toBe(entry.id);
  });

  it("getById returns undefined for missing id", () => {
    expect(store.getById("nonexistent")).toBeUndefined();
  });

  it("clear empties the store", () => {
    store.add({ type: "generate", request: {}, response: {}, durationMs: 10, success: true });
    store.add({ type: "plan", request: {}, response: {}, durationMs: 20, success: true });
    store.clear();

    expect(store.getAll()).toHaveLength(0);
  });

  it("generates different ids after clear (no reuse)", () => {
    const before = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    store.clear();
    const after = store.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    expect(after.id).not.toBe(before.id);
  });

  it("evicts oldest entries and cleans idIndex when at capacity", () => {
    const smallStore = new HistoryStore(3);
    const first = smallStore.add({
      type: "generate",
      request: {},
      response: {},
      durationMs: 10,
      success: true,
    });
    smallStore.add({ type: "plan", request: {}, response: {}, durationMs: 20, success: true });
    smallStore.add({ type: "diff", request: {}, response: {}, durationMs: 30, success: true });
    smallStore.add({ type: "scan", request: {}, response: {}, durationMs: 40, success: true });

    expect(smallStore.getAll()).toHaveLength(3);
    // First entry should have been evicted from index too
    expect(smallStore.getById(first.id)).toBeUndefined();
  });
});
