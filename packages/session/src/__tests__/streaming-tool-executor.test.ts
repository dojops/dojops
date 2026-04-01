/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { StreamingToolExecutor, partitionToolCalls } from "../streaming-tool-executor";
import type { ToolCall, ToolResult } from "@dojops/core";

function makeCall(name: string, id?: string): ToolCall {
  return { id: id ?? `call-${name}`, name, arguments: {} };
}

function makeExecutor(executeFn?: (call: ToolCall) => Promise<ToolResult>) {
  const defaultExecute = async (call: ToolCall): Promise<ToolResult> => ({
    callId: call.id,
    output: `result-${call.name}`,
  });

  return {
    execute: executeFn ?? defaultExecute,
    getFilesWritten: () => [],
    getFilesModified: () => [],
  };
}

describe("StreamingToolExecutor", () => {
  describe("executeBatch", () => {
    it("returns empty results for empty calls", async () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      const result = await ste.executeBatch([]);
      expect(result.results).toEqual([]);
      expect(result.maxParallelism).toBe(0);
    });

    it("executes a single tool call", async () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      const result = await ste.executeBatch([makeCall("read_file")]);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].output).toBe("result-read_file");
    });

    it("runs read-only tools concurrently", async () => {
      const order: string[] = [];
      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        order.push(`start-${call.name}`);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-${call.name}`);
        return { callId: call.id, output: `done-${call.name}` };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
      });

      const calls = [
        makeCall("read_file", "r1"),
        makeCall("search_files", "r2"),
        makeCall("list_files", "r3"),
      ];

      const result = await ste.executeBatch(calls);
      expect(result.results).toHaveLength(3);
      expect(result.maxParallelism).toBe(3);

      // All should start before any end (concurrent execution)
      const starts = order.filter((o) => o.startsWith("start-"));
      const firstEnd = order.findIndex((o) => o.startsWith("end-"));
      expect(starts.length).toBe(3);
      // At least 2 starts should happen before the first end
      expect(firstEnd).toBeGreaterThanOrEqual(2);
    });

    it("runs write tools serially after concurrent reads", async () => {
      const order: string[] = [];
      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        order.push(call.name);
        return { callId: call.id, output: `done` };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
      });

      const calls = [
        makeCall("read_file", "r1"),
        makeCall("write_file", "w1"),
        makeCall("edit_file", "e1"),
      ];

      const result = await ste.executeBatch(calls);
      expect(result.results).toHaveLength(3);

      // write_file must come after read_file
      const writeIdx = order.indexOf("write_file");
      const readIdx = order.indexOf("read_file");
      expect(writeIdx).toBeGreaterThan(readIdx);

      // edit_file must come after write_file (serial)
      const editIdx = order.indexOf("edit_file");
      expect(editIdx).toBeGreaterThan(writeIdx);
    });

    it("preserves original order in results", async () => {
      const delays = new Map([
        ["r1", 30],
        ["r2", 10],
        ["r3", 20],
      ]);

      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        await new Promise((r) => setTimeout(r, delays.get(call.id) ?? 0));
        return { callId: call.id, output: call.id };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
      });

      const calls = [
        makeCall("read_file", "r1"),
        makeCall("search_files", "r2"),
        makeCall("list_files", "r3"),
      ];

      const result = await ste.executeBatch(calls);
      // Results should be in original order regardless of completion order
      expect(result.results[0].callId).toBe("r1");
      expect(result.results[1].callId).toBe("r2");
      expect(result.results[2].callId).toBe("r3");
    });

    it("respects maxConcurrency limit", async () => {
      let activeConcurrency = 0;
      let maxObserved = 0;

      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        activeConcurrency++;
        maxObserved = Math.max(maxObserved, activeConcurrency);
        await new Promise((r) => setTimeout(r, 20));
        activeConcurrency--;
        return { callId: call.id, output: "ok" };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
        maxConcurrency: 2,
      });

      const calls = [
        makeCall("read_file", "r1"),
        makeCall("search_files", "r2"),
        makeCall("list_files", "r3"),
        makeCall("search_skills", "r4"),
      ];

      await ste.executeBatch(calls);
      expect(maxObserved).toBeLessThanOrEqual(2);
    });

    it("falls back to serial for all-write batches", async () => {
      const order: string[] = [];
      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        order.push(call.name);
        return { callId: call.id, output: "ok" };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
      });

      const calls = [
        makeCall("write_file", "w1"),
        makeCall("edit_file", "e1"),
        makeCall("run_command", "c1"),
      ];

      const result = await ste.executeBatch(calls);
      expect(result.maxParallelism).toBe(0); // no concurrent prefix
      expect(order).toEqual(["write_file", "edit_file", "run_command"]);
    });

    it("fires onToolStart and onToolComplete callbacks", async () => {
      const starts: string[] = [];
      const completes: string[] = [];

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
        onToolStart: (call) => starts.push(call.name),
        onToolComplete: (call) => completes.push(call.name),
      });

      await ste.executeBatch([makeCall("read_file"), makeCall("write_file")]);

      expect(starts).toContain("read_file");
      expect(starts).toContain("write_file");
      expect(completes).toContain("read_file");
      expect(completes).toContain("write_file");
    });

    it("handles tool execution errors gracefully", async () => {
      const executeFn = async (call: ToolCall): Promise<ToolResult> => {
        if (call.name === "search_files") {
          return { callId: call.id, output: "Error: file not found", isError: true };
        }
        return { callId: call.id, output: "ok" };
      };

      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor(executeFn) as any,
      });

      const calls = [makeCall("read_file", "r1"), makeCall("search_files", "s1")];

      const result = await ste.executeBatch(calls);
      expect(result.results[0].isError).toBeUndefined();
      expect(result.results[1].isError).toBe(true);
    });

    it("records durationMs", async () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      const result = await ste.executeBatch([makeCall("read_file")]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("executeOne", () => {
    it("executes a single tool call", async () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      const result = await ste.executeOne(makeCall("write_file", "w1"));
      expect(result.callId).toBe("w1");
      expect(result.output).toBe("result-write_file");
    });
  });

  describe("isConcurrencySafe", () => {
    it("marks read-only tools as safe", () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      expect(ste.isConcurrencySafe("read_file")).toBe(true);
      expect(ste.isConcurrencySafe("search_files")).toBe(true);
      expect(ste.isConcurrencySafe("list_files")).toBe(true);
    });

    it("marks write tools as unsafe", () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
      });
      expect(ste.isConcurrencySafe("write_file")).toBe(false);
      expect(ste.isConcurrencySafe("run_command")).toBe(false);
    });

    it("supports custom safe tool set", () => {
      const ste = new StreamingToolExecutor({
        toolExecutor: makeExecutor() as any,
        concurrencySafeTools: new Set(["custom_read", "read_file"]),
      });
      expect(ste.isConcurrencySafe("custom_read")).toBe(true);
      expect(ste.isConcurrencySafe("search_files")).toBe(false); // not in custom set
    });
  });
});

describe("partitionToolCalls", () => {
  it("separates read-only from write tools", () => {
    const calls = [
      makeCall("read_file"),
      makeCall("write_file"),
      makeCall("search_files"),
      makeCall("run_command"),
    ];

    const { readOnly, write } = partitionToolCalls(calls);
    expect(readOnly.map((c) => c.name)).toEqual(["read_file", "search_files"]);
    expect(write.map((c) => c.name)).toEqual(["write_file", "run_command"]);
  });

  it("handles all-read batch", () => {
    const calls = [makeCall("read_file"), makeCall("search_files")];
    const { readOnly, write } = partitionToolCalls(calls);
    expect(readOnly).toHaveLength(2);
    expect(write).toHaveLength(0);
  });

  it("handles all-write batch", () => {
    const calls = [makeCall("write_file"), makeCall("edit_file")];
    const { readOnly, write } = partitionToolCalls(calls);
    expect(readOnly).toHaveLength(0);
    expect(write).toHaveLength(2);
  });

  it("supports custom safe tools", () => {
    const custom = new Set(["my_query"]);
    const calls = [makeCall("my_query"), makeCall("write_file")];
    const { readOnly, write } = partitionToolCalls(calls, custom);
    expect(readOnly).toHaveLength(1);
    expect(write).toHaveLength(1);
  });
});
