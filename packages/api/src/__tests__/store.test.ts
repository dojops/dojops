import { describe, it, expect, beforeEach } from "vitest";
import { HistoryStore, redactSecrets } from "../store";

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

  describe("T-8: eviction boundary tests", () => {
    it("all entries present when at exact capacity", () => {
      const capacity = 5;
      const boundedStore = new HistoryStore(capacity);
      const entries = [];

      for (let i = 0; i < capacity; i++) {
        entries.push(
          boundedStore.add({
            type: "generate",
            request: { index: i },
            response: {},
            durationMs: i * 10,
            success: true,
          }),
        );
      }

      // All entries should be present
      expect(boundedStore.getAll()).toHaveLength(capacity);

      // Every entry should be retrievable by ID
      for (const entry of entries) {
        expect(boundedStore.getById(entry.id)).toBeDefined();
        expect(boundedStore.getById(entry.id)!.id).toBe(entry.id);
      }
    });

    it("evicts oldest entry when one entry exceeds capacity", () => {
      const capacity = 5;
      const boundedStore = new HistoryStore(capacity);
      const entries = [];

      for (let i = 0; i < capacity; i++) {
        entries.push(
          boundedStore.add({
            type: "generate",
            request: { index: i },
            response: {},
            durationMs: i * 10,
            success: true,
          }),
        );
      }

      // Add one more entry beyond capacity
      const overflowEntry = boundedStore.add({
        type: "scan",
        request: { index: capacity },
        response: {},
        durationMs: 999,
        success: true,
      });

      // Store should still be at capacity
      expect(boundedStore.getAll()).toHaveLength(capacity);

      // The oldest (first) entry should be evicted
      expect(boundedStore.getById(entries[0].id)).toBeUndefined();

      // Entries 1..4 should still be present
      for (let i = 1; i < capacity; i++) {
        expect(boundedStore.getById(entries[i].id)).toBeDefined();
      }

      // The new overflow entry should be retrievable
      expect(boundedStore.getById(overflowEntry.id)).toBeDefined();
      expect(boundedStore.getById(overflowEntry.id)!.type).toBe("scan");
    });

    it("evicted entry is not retrievable by ID", () => {
      const boundedStore = new HistoryStore(2);
      const first = boundedStore.add({
        type: "generate",
        request: { n: 1 },
        response: {},
        durationMs: 10,
        success: true,
      });
      boundedStore.add({
        type: "plan",
        request: { n: 2 },
        response: {},
        durationMs: 20,
        success: true,
      });

      // At capacity — first still accessible
      expect(boundedStore.getById(first.id)).toBeDefined();

      // Trigger eviction
      boundedStore.add({
        type: "diff",
        request: { n: 3 },
        response: {},
        durationMs: 30,
        success: true,
      });

      // First entry should be gone from both getAll and getById
      expect(boundedStore.getById(first.id)).toBeUndefined();
      const allIds = boundedStore.getAll().map((e) => e.id);
      expect(allIds).not.toContain(first.id);
    });

    it("new entry IS retrievable by ID after eviction", () => {
      const boundedStore = new HistoryStore(2);
      boundedStore.add({
        type: "generate",
        request: {},
        response: {},
        durationMs: 10,
        success: true,
      });
      boundedStore.add({
        type: "plan",
        request: {},
        response: {},
        durationMs: 20,
        success: true,
      });

      // Add beyond capacity
      const newest = boundedStore.add({
        type: "diff",
        request: { newest: true },
        response: {},
        durationMs: 30,
        success: true,
      });

      const found = boundedStore.getById(newest.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(newest.id);
      expect(found!.type).toBe("diff");
      expect((found!.request as { newest: boolean }).newest).toBe(true);
    });

    it("getAll returns entries in correct order after eviction", () => {
      const boundedStore = new HistoryStore(3);
      const e1 = boundedStore.add({
        type: "generate",
        request: { n: 1 },
        response: {},
        durationMs: 10,
        success: true,
      });
      const e2 = boundedStore.add({
        type: "plan",
        request: { n: 2 },
        response: {},
        durationMs: 20,
        success: true,
      });
      const e3 = boundedStore.add({
        type: "diff",
        request: { n: 3 },
        response: {},
        durationMs: 30,
        success: true,
      });
      // Trigger eviction of e1
      const e4 = boundedStore.add({
        type: "scan",
        request: { n: 4 },
        response: {},
        durationMs: 40,
        success: true,
      });

      const all = boundedStore.getAll();
      expect(all).toHaveLength(3);

      // getAll returns reverse-chronological order: newest first
      expect(all[0].id).toBe(e4.id);
      expect(all[1].id).toBe(e3.id);
      expect(all[2].id).toBe(e2.id);

      // e1 should not appear
      expect(all.find((e) => e.id === e1.id)).toBeUndefined();
    });

    it("multiple evictions work correctly when adding many entries beyond capacity", () => {
      const boundedStore = new HistoryStore(3);
      const allAdded = [];

      // Add 7 entries to a store with capacity 3 — should evict 4
      for (let i = 0; i < 7; i++) {
        allAdded.push(
          boundedStore.add({
            type: "generate",
            request: { index: i },
            response: {},
            durationMs: i,
            success: true,
          }),
        );
      }

      expect(boundedStore.getAll()).toHaveLength(3);

      // First 4 entries (indices 0-3) should be evicted
      for (let i = 0; i < 4; i++) {
        expect(boundedStore.getById(allAdded[i].id)).toBeUndefined();
      }

      // Last 3 entries (indices 4-6) should be present
      for (let i = 4; i < 7; i++) {
        expect(boundedStore.getById(allAdded[i].id)).toBeDefined();
      }

      // Order should be newest first
      const all = boundedStore.getAll();
      expect(all[0].id).toBe(allAdded[6].id);
      expect(all[1].id).toBe(allAdded[5].id);
      expect(all[2].id).toBe(allAdded[4].id);
    });
  });

  describe("G-10: secret redaction", () => {
    it("redacts AWS access key IDs", () => {
      const entry = store.add({
        type: "generate",
        request: { prompt: "key is AKIAIOSFODNN7EXAMPLE" },
        response: {},
        durationMs: 10,
        success: true,
      });
      expect((entry.request as { prompt: string }).prompt).toBe("key is AKIA***REDACTED***");
    });

    it("redacts GitHub personal access tokens", () => {
      const entry = store.add({
        type: "generate",
        request: { prompt: "token: ghp_abc123XYZ456" },
        response: {},
        durationMs: 10,
        success: true,
      });
      expect((entry.request as { prompt: string }).prompt).toBe("token: ghp_***REDACTED***");
    });

    it("redacts OpenAI-style API keys", () => {
      const entry = store.add({
        type: "generate",
        request: { prompt: "api key sk-abcdefghijklmnopqrstuvwxyz" },
        response: {},
        durationMs: 10,
        success: true,
      });
      expect((entry.request as { prompt: string }).prompt).toBe("api key sk-***REDACTED***");
    });

    it("redacts Bearer tokens", () => {
      const entry = store.add({
        type: "generate",
        request: { prompt: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test" },
        response: {},
        durationMs: 10,
        success: true,
      });
      expect((entry.request as { prompt: string }).prompt).toContain("Bearer ***REDACTED***");
    });

    it("redacts secrets in response content", () => {
      const entry = store.add({
        type: "generate",
        request: {},
        response: { content: "use AKIAIOSFODNN7EXAMPLE as key" },
        durationMs: 10,
        success: true,
      });
      expect((entry.response as { content: string }).content).toBe("use AKIA***REDACTED*** as key");
    });

    it("redacts secrets in error field", () => {
      const entry = store.add({
        type: "generate",
        request: {},
        response: null,
        durationMs: 10,
        success: false,
        error: "failed with ghp_secrettoken123",
      });
      expect(entry.error).toBe("failed with ghp_***REDACTED***");
    });

    it("handles nested objects", () => {
      const entry = store.add({
        type: "generate",
        request: { headers: { authorization: "Bearer mytoken123" } },
        response: {},
        durationMs: 10,
        success: true,
      });
      const req = entry.request as { headers: { authorization: string } };
      expect(req.headers.authorization).toBe("Bearer ***REDACTED***");
    });
  });
});

describe("redactSecrets", () => {
  it("redacts AWS key pattern", () => {
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toBe("AKIA***REDACTED***");
  });

  it("redacts GitHub token pattern", () => {
    expect(redactSecrets("ghp_abcdef123456")).toBe("ghp_***REDACTED***");
  });

  it("redacts sk- pattern with 20+ chars", () => {
    expect(redactSecrets("sk-12345678901234567890")).toBe("sk-***REDACTED***");
  });

  it("does not redact short sk- patterns", () => {
    expect(redactSecrets("sk-short")).toBe("sk-short");
  });

  it("returns unchanged text with no secrets", () => {
    const text = "This is a normal message with no secrets.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("redacts multiple secrets in one string", () => {
    const text = "aws=AKIAIOSFODNN7EXAMPLE gh=ghp_token123456";
    const result = redactSecrets(text);
    expect(result).toBe("aws=AKIA***REDACTED*** gh=ghp_***REDACTED***");
  });
});
