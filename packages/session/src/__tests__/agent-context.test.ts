import { describe, it, expect, vi } from "vitest";
import { AgentContext } from "../agent-context";
import type { LLMProvider, ToolDefinition, ToolCall, ToolResult } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";

function mockProvider(): LLMProvider {
  return { name: "test", generate: vi.fn() };
}

function mockToolExecutor(): ToolExecutor {
  return {
    execute: vi.fn(
      async (call: ToolCall): Promise<ToolResult> => ({
        callId: call.id,
        output: "ok",
      }),
    ),
    getFilesWritten: vi.fn(() => []),
    getFilesModified: vi.fn(() => []),
  } as unknown as ToolExecutor;
}

const tools: ToolDefinition[] = [
  { name: "read_file", description: "Read a file", parameters: {} },
  { name: "write_file", description: "Write a file", parameters: {} },
];

describe("AgentContext", () => {
  it("creates with defaults", () => {
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "You are helpful",
    });

    expect(ctx.isAborted).toBe(false);
    expect(ctx.messages).toEqual([]);
    expect(ctx.tools).toHaveLength(2);
    expect(ctx.getBudgetSnapshot().totalConsumed).toBe(0);
  });

  it("has independent abort controller", () => {
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "test",
    });

    expect(ctx.isAborted).toBe(false);
    ctx.abort("testing");
    expect(ctx.isAborted).toBe(true);
  });

  it("chains abort to parent signal", () => {
    const parent = new AbortController();
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "test",
      abortSignal: parent.signal,
    });

    expect(ctx.isAborted).toBe(false);
    parent.abort("parent killed");
    expect(ctx.isAborted).toBe(true);
  });

  it("tracks budget independently", () => {
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "test",
      maxTotalTokens: 10_000,
    });

    ctx.tracker.recordUsage({ promptTokens: 500, completionTokens: 500, totalTokens: 1000 });
    expect(ctx.tracker.budgetRemaining()).toBe(9000);
    expect(ctx.tracker.isBudgetExhausted()).toBe(false);
  });

  it("defensively copies tools array", () => {
    const originalTools = [...tools];
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools: originalTools,
      systemPrompt: "test",
    });

    originalTools.push({ name: "new_tool", description: "sneaky", parameters: {} });
    expect(ctx.tools).toHaveLength(2);
  });

  it("reports age", async () => {
    const ctx = new AgentContext({
      provider: mockProvider(),
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "test",
    });

    expect(ctx.getAge()).toBeGreaterThanOrEqual(0);
    expect(ctx.getAge()).toBeLessThan(1000);
  });

  describe("createChild", () => {
    it("creates child with fraction of parent budget", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent",
        maxTotalTokens: 100_000,
      });

      const child = parent.createChild();
      // Default 25% of remaining = 25_000
      const snap = child.getBudgetSnapshot();
      expect(snap.contextLimit).toBeGreaterThan(0);
    });

    it("chains child abort to parent", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent",
      });

      const child = parent.createChild();
      expect(child.isAborted).toBe(false);
      parent.abort("parent done");
      expect(child.isAborted).toBe(true);
    });

    it("child abort does not affect parent", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent",
      });

      const child = parent.createChild();
      child.abort("child done");
      expect(child.isAborted).toBe(true);
      expect(parent.isAborted).toBe(false);
    });

    it("allows tool subset for child", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent",
      });

      const readOnly = [tools[0]]; // only read_file
      const child = parent.createChild({ tools: readOnly });
      expect(child.tools).toHaveLength(1);
      expect(child.tools[0].name).toBe("read_file");
    });

    it("allows custom system prompt for child", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent prompt",
      });

      const child = parent.createChild({ systemPrompt: "child prompt" });
      expect(child.systemPrompt).toBe("child prompt");
    });

    it("has empty message history", () => {
      const parent = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "parent",
      });
      parent.messages.push({ role: "user", content: "parent msg" });

      const child = parent.createChild();
      expect(child.messages).toEqual([]);
    });
  });

  describe("summarizeResults", () => {
    it("returns last assistant message", () => {
      const ctx = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "test",
      });

      ctx.messages.push(
        { role: "assistant", content: "First response" },
        { role: "user", content: "Follow up" },
        { role: "assistant", content: "Final answer" },
      );

      expect(ctx.summarizeResults()).toBe("Final answer");
    });

    it("truncates long results", () => {
      const ctx = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "test",
      });

      ctx.messages.push({ role: "assistant", content: "x".repeat(5000) });
      const summary = ctx.summarizeResults();
      expect(summary.length).toBeLessThanOrEqual(2020);
      expect(summary).toContain("[result truncated]");
    });

    it("returns placeholder when no assistant messages", () => {
      const ctx = new AgentContext({
        provider: mockProvider(),
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "test",
      });

      expect(ctx.summarizeResults()).toBe("(no results)");
    });
  });
});
