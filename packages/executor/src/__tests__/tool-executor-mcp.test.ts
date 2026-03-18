import { describe, it, expect, vi } from "vitest";
import { ToolExecutor } from "../tool-executor";
import type { McpToolDispatcher } from "../tool-executor";
import type { ExecutionPolicy } from "../types";

const basePolicy: ExecutionPolicy = {
  allowWrite: true,
  allowedWritePaths: ["/tmp"],
  deniedWritePaths: [],
  enforceDevOpsAllowlist: false,
  allowNetwork: false,
  allowEnvVars: [],
  timeoutMs: 10_000,
  maxFileSizeBytes: 1_048_576,
  requireApproval: false,
  skipVerification: false,
  maxVerifyRetries: 0,
  approvalMode: "never",
  autoApproveRiskLevel: "LOW",
  maxRepairAttempts: 0,
};

function createMockMcpDispatcher(overrides?: Partial<McpToolDispatcher>): McpToolDispatcher {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    canHandle: vi.fn().mockImplementation((name: string) => name.startsWith("mcp__")),
    getToolDefinitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({
      callId: "test",
      output: "MCP tool result",
      isError: false,
    }),
    ...overrides,
  };
}

describe("ToolExecutor MCP integration", () => {
  it("dispatches mcp__ prefixed tools to MCP dispatcher", async () => {
    const mcpDispatcher = createMockMcpDispatcher();
    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
      mcpDispatcher,
    });

    const result = await executor.execute({
      id: "call-1",
      name: "mcp__memory__read",
      arguments: { key: "test" },
    });

    expect(mcpDispatcher.execute).toHaveBeenCalledWith({
      id: "call-1",
      name: "mcp__memory__read",
      arguments: { key: "test" },
    });
    expect(result.output).toBe("MCP tool result");
    expect(result.isError).toBeFalsy();
  });

  it("still handles built-in tools normally when MCP dispatcher exists", async () => {
    const mcpDispatcher = createMockMcpDispatcher();
    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
      mcpDispatcher,
    });

    const result = await executor.execute({
      id: "call-2",
      name: "done",
      arguments: { summary: "All done" },
    });

    expect(mcpDispatcher.execute).not.toHaveBeenCalled();
    expect(result.output).toBe("All done");
  });

  it("falls back to unknown tool error when MCP dispatcher does not handle", async () => {
    const mcpDispatcher = createMockMcpDispatcher({
      canHandle: vi.fn().mockReturnValue(false),
    });
    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
      mcpDispatcher,
    });

    const result = await executor.execute({
      id: "call-3",
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unknown tool");
  });

  it("works without MCP dispatcher (backward compatibility)", async () => {
    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
    });

    const result = await executor.execute({
      id: "call-4",
      name: "mcp__memory__read",
      arguments: {},
    });

    // Without dispatcher, MCP tools are unknown
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unknown tool");
  });

  it("propagates MCP errors correctly", async () => {
    const mcpDispatcher = createMockMcpDispatcher({
      execute: vi.fn().mockResolvedValue({
        callId: "call-5",
        output: "Server connection failed",
        isError: true,
      }),
    });
    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
      mcpDispatcher,
    });

    const result = await executor.execute({
      id: "call-5",
      name: "mcp__remote__query",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.output).toBe("Server connection failed");
  });

  it("calls onToolStart and onToolEnd for MCP tools", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const mcpDispatcher = createMockMcpDispatcher();

    const executor = new ToolExecutor({
      policy: basePolicy,
      cwd: "/tmp",
      mcpDispatcher,
      onToolStart,
      onToolEnd,
    });

    await executor.execute({
      id: "call-6",
      name: "mcp__memory__write",
      arguments: { key: "k", value: "v" },
    });

    expect(onToolStart).toHaveBeenCalledOnce();
    expect(onToolEnd).toHaveBeenCalledOnce();
  });
});
