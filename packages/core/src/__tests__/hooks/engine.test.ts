import { describe, it, expect, vi, beforeEach } from "vitest";
import { HookEngine, HookExecutionError } from "../../hooks/engine";
import type { HookDefinition } from "../../hooks/types";

function makeCommandHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: "test-hook",
    events: ["SessionStart"],
    type: "command",
    command: 'echo "hello"',
    ...overrides,
  };
}

function makeHttpHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: "http-hook",
    events: ["SessionStart"],
    type: "http",
    url: "http://localhost:9999/webhook",
    ...overrides,
  };
}

describe("HookEngine", () => {
  let engine: HookEngine;

  beforeEach(() => {
    engine = new HookEngine();
  });

  describe("register", () => {
    it("registers a hook", () => {
      engine.register(makeCommandHook());
      expect(engine.getHooks()).toHaveLength(1);
      expect(engine.getHooks()[0].id).toBe("test-hook");
    });

    it("replaces hook with same id", () => {
      engine.register(makeCommandHook({ command: "echo first" }));
      engine.register(makeCommandHook({ command: "echo second" }));
      expect(engine.getHooks()).toHaveLength(1);
      expect(engine.getHooks()[0].command).toBe("echo second");
    });

    it("throws if hook has no id", () => {
      expect(() => engine.register({ ...makeCommandHook(), id: "" })).toThrow("must have an id");
    });

    it("throws if hook has no events", () => {
      expect(() => engine.register({ ...makeCommandHook(), events: [] })).toThrow(
        "at least one event",
      );
    });

    it("throws if command hook has no command", () => {
      expect(() => engine.register({ ...makeCommandHook(), command: undefined })).toThrow(
        "has no command",
      );
    });

    it("throws if http hook has no url", () => {
      expect(() => engine.register({ ...makeHttpHook(), url: undefined })).toThrow("has no url");
    });
  });

  describe("unregister", () => {
    it("removes a hook", () => {
      engine.register(makeCommandHook());
      expect(engine.unregister("test-hook")).toBe(true);
      expect(engine.getHooks()).toHaveLength(0);
    });

    it("returns false for non-existent hook", () => {
      expect(engine.unregister("nope")).toBe(false);
    });

    it("cleans up event index", () => {
      engine.register(makeCommandHook());
      engine.unregister("test-hook");
      expect(engine.getHooksForEvent("SessionStart")).toHaveLength(0);
    });
  });

  describe("getHooksForEvent", () => {
    it("returns hooks subscribed to the event", () => {
      engine.register(makeCommandHook({ id: "a", events: ["SessionStart", "SessionEnd"] }));
      engine.register(makeCommandHook({ id: "b", events: ["SessionEnd"] }));

      expect(engine.getHooksForEvent("SessionStart")).toHaveLength(1);
      expect(engine.getHooksForEvent("SessionEnd")).toHaveLength(2);
      expect(engine.getHooksForEvent("PreExecute")).toHaveLength(0);
    });

    it("excludes disabled hooks", () => {
      engine.register(makeCommandHook({ disabled: true }));
      expect(engine.getHooksForEvent("SessionStart")).toHaveLength(0);
    });
  });

  describe("emit — command hooks", () => {
    it("executes a command hook and returns output", async () => {
      engine.register(makeCommandHook({ command: 'echo "hook ran"' }));
      const results = await engine.emit("SessionStart", { foo: "bar" });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe("hook ran");
      expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("passes event data to stdin", async () => {
      // cat reads stdin and prints it
      engine.register(makeCommandHook({ command: "cat" }));
      const results = await engine.emit("SessionStart", { key: "value" });

      expect(results[0].success).toBe(true);
      const parsed = JSON.parse(results[0].output!);
      expect(parsed.event).toBe("SessionStart");
      expect(parsed.payload.key).toBe("value");
      expect(parsed.timestamp).toBeDefined();
    });

    it("sets DOJOPS_HOOK_EVENT env var", async () => {
      engine.register(
        makeCommandHook({ events: ["PreExecute"], command: 'echo "$DOJOPS_HOOK_EVENT"' }),
      );
      const results = await engine.emit("PreExecute");

      expect(results[0].output).toBe("PreExecute");
    });

    it("captures failures without throwing (non-blocking default)", async () => {
      engine.register(makeCommandHook({ command: "exit 1" }));
      const results = await engine.emit("SessionStart");

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });

    it("respects timeout", async () => {
      engine.register(makeCommandHook({ command: "sleep 30", timeoutMs: 100 }));
      const results = await engine.emit("SessionStart");

      expect(results[0].success).toBe(false);
      expect(results[0].durationMs).toBeLessThan(5000);
    });

    it("runs multiple hooks concurrently", async () => {
      engine.register(makeCommandHook({ id: "a", command: 'echo "a"' }));
      engine.register(makeCommandHook({ id: "b", command: 'echo "b"' }));
      const results = await engine.emit("SessionStart");

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("returns empty array for events with no hooks", async () => {
      const results = await engine.emit("PreExecute");
      expect(results).toEqual([]);
    });
  });

  describe("emit — blocking hooks", () => {
    it("throws HookExecutionError for blocking hook failure", async () => {
      engine.register(makeCommandHook({ command: "exit 1", nonBlocking: false }));

      await expect(engine.emit("SessionStart")).rejects.toThrow(HookExecutionError);
    });

    it("includes failure details in HookExecutionError", async () => {
      engine.register(makeCommandHook({ command: "exit 1", nonBlocking: false }));

      try {
        await engine.emit("SessionStart");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HookExecutionError);
        const hookErr = err as HookExecutionError;
        expect(hookErr.failures).toHaveLength(1);
        expect(hookErr.failures[0].hookId).toBe("test-hook");
      }
    });

    it("does not throw if blocking hook succeeds", async () => {
      engine.register(makeCommandHook({ command: 'echo "ok"', nonBlocking: false }));

      const results = await engine.emit("SessionStart");
      expect(results[0].success).toBe(true);
    });
  });

  describe("emit — http hooks", () => {
    it("calls fetch with correct parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"status":"ok"}'),
      });
      vi.stubGlobal("fetch", mockFetch);

      engine.register(makeHttpHook());
      const results = await engine.emit("SessionStart", { msg: "test" });

      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe('{"status":"ok"}');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:9999/webhook");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.event).toBe("SessionStart");
      expect(body.payload.msg).toBe("test");

      vi.unstubAllGlobals();
    });

    it("handles HTTP error responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Internal Server Error"),
        }),
      );

      engine.register(makeHttpHook());
      const results = await engine.emit("SessionStart");

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("500");

      vi.unstubAllGlobals();
    });

    it("handles fetch rejection", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      engine.register(makeHttpHook());
      const results = await engine.emit("SessionStart");

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain("ECONNREFUSED");

      vi.unstubAllGlobals();
    });
  });

  describe("constructor with config", () => {
    it("loads hooks from config", () => {
      const engine = new HookEngine({
        hooks: [makeCommandHook({ id: "a" }), makeCommandHook({ id: "b", events: ["PreExecute"] })],
      });

      expect(engine.getHooks()).toHaveLength(2);
      expect(engine.getHooksForEvent("SessionStart")).toHaveLength(1);
      expect(engine.getHooksForEvent("PreExecute")).toHaveLength(1);
    });
  });

  describe("onLog callback", () => {
    it("receives warning on hook failure", async () => {
      const logSpy = vi.fn();
      engine.onLog = logSpy;

      engine.register(makeCommandHook({ command: "exit 42" }));
      await engine.emit("SessionStart");

      expect(logSpy).toHaveBeenCalledWith("warn", expect.stringContaining("test-hook"));
    });
  });
});
