import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpToolDispatcher } from "../dispatcher";
import type { McpClientManager } from "../client-manager";
import type { ToolCall } from "@dojops/core";

function createMockManager(overrides: Partial<McpClientManager> = {}): McpClientManager {
  return {
    connectAll: vi.fn(),
    disconnectAll: vi.fn(),
    getConnectedServers: vi.fn().mockReturnValue(["memory", "github"]),
    getToolDefinitions: vi.fn().mockReturnValue([
      { name: "mcp__memory__read", description: "[MCP: memory] Read", parameters: {} },
      { name: "mcp__github__list_repos", description: "[MCP: github] List repos", parameters: {} },
    ]),
    callTool: vi.fn().mockResolvedValue({ content: "result", isError: false }),
    ...overrides,
  } as unknown as McpClientManager;
}

function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: "call-1", name, arguments: args };
}

describe("McpToolDispatcher", () => {
  let dispatcher: McpToolDispatcher;
  let mockManager: McpClientManager;

  beforeEach(() => {
    mockManager = createMockManager();
    dispatcher = new McpToolDispatcher(mockManager);
  });

  describe("isConnected", () => {
    it("returns true when servers are connected", () => {
      expect(dispatcher.isConnected()).toBe(true);
    });

    it("returns false when no servers connected", () => {
      const empty = createMockManager({
        getConnectedServers: vi.fn().mockReturnValue([]),
      });
      const d = new McpToolDispatcher(empty);
      expect(d.isConnected()).toBe(false);
    });
  });

  describe("canHandle", () => {
    it("returns true for mcp__ prefixed tools", () => {
      expect(dispatcher.canHandle("mcp__memory__read")).toBe(true);
      expect(dispatcher.canHandle("mcp__github__list_repos")).toBe(true);
    });

    it("returns true for deeply nested tool names", () => {
      expect(dispatcher.canHandle("mcp__server__some__nested__tool")).toBe(true);
    });

    it("returns false for non-MCP tools", () => {
      expect(dispatcher.canHandle("bash")).toBe(false);
      expect(dispatcher.canHandle("file_read")).toBe(false);
      expect(dispatcher.canHandle("done")).toBe(false);
    });

    it("returns false for single-underscore prefix", () => {
      expect(dispatcher.canHandle("mcp_single_underscore")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(dispatcher.canHandle("")).toBe(false);
    });
  });

  describe("getToolDefinitions", () => {
    it("delegates to manager and returns all tools", () => {
      const tools = dispatcher.getToolDefinitions();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("mcp__memory__read");
      expect(tools[1].name).toBe("mcp__github__list_repos");
    });

    it("returns empty array when no tools", () => {
      const empty = createMockManager({
        getToolDefinitions: vi.fn().mockReturnValue([]),
      });
      const d = new McpToolDispatcher(empty);
      expect(d.getToolDefinitions()).toEqual([]);
    });
  });

  describe("execute", () => {
    it("parses tool name and routes to correct server", async () => {
      const result = await dispatcher.execute(makeToolCall("mcp__memory__read", { key: "test" }));

      expect(mockManager.callTool).toHaveBeenCalledWith("memory", "read", { key: "test" });
      expect(result).toEqual({
        callId: "call-1",
        output: "result",
        isError: false,
      });
    });

    it("handles underscored tool names correctly", async () => {
      await dispatcher.execute(makeToolCall("mcp__github__list_repos", { org: "dojops" }));

      expect(mockManager.callTool).toHaveBeenCalledWith("github", "list_repos", { org: "dojops" });
    });

    it("handles server names with underscores", async () => {
      await dispatcher.execute(makeToolCall("mcp__my_server__my_tool"));

      // First __ after mcp__ splits server from tool
      expect(mockManager.callTool).toHaveBeenCalledWith("my_server", "my_tool", {});
    });

    it("returns error for mcp__ with no separator after prefix", async () => {
      const result = await dispatcher.execute(makeToolCall("mcp__"));

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("returns error for missing double-underscore separator", async () => {
      const result = await dispatcher.execute(makeToolCall("mcp__servernameonly"));

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("returns error for empty tool name (trailing separator)", async () => {
      const result = await dispatcher.execute(makeToolCall("mcp__server__"));

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("returns error for non-MCP tool name", async () => {
      const result = await dispatcher.execute(makeToolCall("bash"));

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("propagates isError from manager.callTool", async () => {
      const errorManager = createMockManager({
        callTool: vi.fn().mockResolvedValue({
          content: 'MCP server "unknown" not connected',
          isError: true,
        }),
      });
      const d = new McpToolDispatcher(errorManager);

      const result = await d.execute(makeToolCall("mcp__unknown__tool"));

      expect(result.isError).toBe(true);
      expect(result.output).toContain("not connected");
    });

    it("passes complex arguments through correctly", async () => {
      const args = { query: "SELECT 1", database: "mydb", limit: 100, nested: { a: 1 } };
      await dispatcher.execute(makeToolCall("mcp__postgres__query", args));

      expect(mockManager.callTool).toHaveBeenCalledWith("postgres", "query", args);
    });

    it("handles empty arguments", async () => {
      await dispatcher.execute(makeToolCall("mcp__memory__list"));

      expect(mockManager.callTool).toHaveBeenCalledWith("memory", "list", {});
    });
  });
});
