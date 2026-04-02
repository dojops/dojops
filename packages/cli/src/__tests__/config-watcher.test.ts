import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConfigWatcher } from "../config-watcher";

describe("ConfigWatcher", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-watcher-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts and detects file changes", async () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, '{"defaultProvider":"openai"}');

    const onChange = vi.fn();
    const watcher = new ConfigWatcher([filePath], onChange, 50);

    try {
      watcher.start();
      expect(watcher.isWatching()).toBe(true);

      // Modify the file
      fs.writeFileSync(filePath, '{"defaultProvider":"anthropic"}');

      // Wait for debounce + fs.watch delivery
      await waitFor(() => onChange.mock.calls.length > 0, 2000);

      expect(onChange).toHaveBeenCalledWith(filePath);
    } finally {
      watcher.stop();
    }
  });

  it("debounces multiple rapid changes into a single callback", async () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, '{"v":0}');

    const onChange = vi.fn();
    const watcher = new ConfigWatcher([filePath], onChange, 100);

    try {
      watcher.start();

      // Rapid-fire writes
      for (let i = 1; i <= 5; i++) {
        fs.writeFileSync(filePath, `{"v":${i}}`);
        await sleep(10);
      }

      // Wait for debounce to settle
      await sleep(300);

      // Should have at most 2 calls (rapid writes collapse, but fs.watch may batch differently).
      // The key property: fewer callbacks than writes.
      expect(onChange.mock.calls.length).toBeLessThanOrEqual(2);
      expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(onChange).toHaveBeenCalledWith(filePath);
    } finally {
      watcher.stop();
    }
  });

  it("stop() cleans up watchers and returns isWatching() false", () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, "{}");

    const watcher = new ConfigWatcher([filePath], vi.fn());
    watcher.start();
    expect(watcher.isWatching()).toBe(true);

    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it("stop() cancels pending debounce timers", async () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, "{}");

    const onChange = vi.fn();
    const watcher = new ConfigWatcher([filePath], onChange, 200);

    try {
      watcher.start();

      // Write to trigger a debounce timer
      fs.writeFileSync(filePath, '{"changed":true}');

      // Stop before debounce fires
      await sleep(50);
      watcher.stop();

      // Wait past the debounce window
      await sleep(300);

      // Callback should not fire after stop
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      watcher.stop(); // idempotent
    }
  });

  it("gracefully handles missing files (ENOENT)", () => {
    const missingPath = path.join(tmpDir, "does-not-exist.json");

    const watcher = new ConfigWatcher([missingPath], vi.fn());
    // Should not throw
    watcher.start();
    expect(watcher.isWatching()).toBe(false);
    watcher.stop();
  });

  it("watches only existing files, skips missing ones", () => {
    const existingPath = path.join(tmpDir, "exists.json");
    const missingPath = path.join(tmpDir, "missing.json");
    fs.writeFileSync(existingPath, "{}");

    const watcher = new ConfigWatcher([existingPath, missingPath], vi.fn());
    watcher.start();
    expect(watcher.isWatching()).toBe(true);
    watcher.stop();
  });

  it("handles file deletion during watch", async () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, "{}");

    const onChange = vi.fn();
    const watcher = new ConfigWatcher([filePath], onChange, 50);

    try {
      watcher.start();
      expect(watcher.isWatching()).toBe(true);

      // Delete the file
      fs.unlinkSync(filePath);

      // Wait for fs.watch to deliver the rename event + debounce
      await sleep(200);

      // The callback should not fire for a deleted file (existsSync check prevents it),
      // or the watcher should have cleaned up.
      // Either way, no crash occurred — that's the main assertion.
    } finally {
      watcher.stop();
    }
  });

  it("can be stopped multiple times without error", () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, "{}");

    const watcher = new ConfigWatcher([filePath], vi.fn());
    watcher.start();
    watcher.stop();
    watcher.stop(); // idempotent
    expect(watcher.isWatching()).toBe(false);
  });
});

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until predicate returns true, or timeout. */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(check, 20);
    };
    check();
  });
}
