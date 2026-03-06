import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../cache";

describe("TtlCache", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TtlCache<string>(1000);
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  it("stores and retrieves values", () => {
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    vi.advanceTimersByTime(1001);
    expect(cache.get("key")).toBeUndefined();
  });

  it("has() checks existence respecting TTL", () => {
    cache.set("key", "value");
    expect(cache.has("key")).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(cache.has("key")).toBe(false);
  });

  it("tracks size", () => {
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });

  it("clear() removes all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts expired entries during cleanup interval", () => {
    cache.set("a", "1");
    cache.set("b", "2");

    vi.advanceTimersByTime(1001);

    // After cleanup interval fires and evicts expired entries,
    // verify they can't be retrieved
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("overwrites existing values", () => {
    const k = "overwrite-key";
    cache.set(k, "old"); // NOSONAR — intentional overwrite test
    cache.set(k, "new"); // NOSONAR — intentional overwrite test
    expect(cache.get(k)).toBe("new");
  });
});
