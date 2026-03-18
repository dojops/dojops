import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpToolDispatcher } from "../dispatcher";
import type { McpClientManager } from "../client-manager";

function createMockManager(overrides?: Partial<McpClientManager>): McpClientManager {
  return {
    connectAll: vi.fn(),
    disconnectAll: vi.fn(),
    getConnectedServers: vi.fn().mockReturnValue(["memory", "github"]),
    getToolDefinitions: vi.fn().mockReturnValue([
      { name: "mcp__memory__read", description: "Read", parameters: {} },
      { name: "mcp__github__list_repos", description: "List repos", parameters: {} },
    ]),
    callTool: vi.fn().mockResolvedValue({ content: "result", isError: false }),
    ...overrides,
  } as unknown as McpClientManager;
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
        getConnectedServers: vi.fn().mockReturnValue([]) as never,
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

    it("returns false for non-MCP tools", () => {
      expect(dispatcher.canHandle("read_file")).toBe(false);
      expect(dispatcher.canHandle("write_file")).toBe(false);
      expect(dispatcher.canHandle("done")).toBe(false);
    });
  });

  describe("getToolDefinitions", () => {
    it("returns all MCP tool definitions", () => {
      const tools = dispatcher.getToolDefinitions();
      expect(tools).toHaveLength(2);
    });
  });

  describe("execute", () => {
    it("routes to correct server based on tool name", async () => {
      const result = await dispatcher.execute({
        id: "call-1",
        name: "mcp__memory__read",
        arguments: { key: "test" },
      });

      expect(mockManager.callTool).toHaveBeenCalledWith("memory", "read", { key: "test" });
      expect(result.callId).toBe("call-1");
      expect(result.output).toBe("result");
      expect(result.isError).toBe(false);
    });

    it("routes multi-segment tool names correctly", async () => {
      await dispatcher.execute({
        id: "call-2",
        name: "mcp__github__list_repos",
        arguments: { org: "dojops" },
      });

      expect(mockManager.callTool).toHaveBeenCalledWith("github", "list_repos", { org: "dojops" });
    });

    it("returns error for invalid MCP tool name format", async () => {
      const result = await dispatcher.execute({
        id: "call-3",
        name: "mcp__",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("returns error for missing double-underscore separator", async () => {
      const result = await dispatcher.execute({
        id: "call-4",
        name: "mcp__servernameonly",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Invalid MCP tool name format");
    });

    it("propagates error from callTool", async () => {
      const errorManager = createMockManager({
        callTool: vi
          .fn()
          .mockResolvedValue({ content: "connection error", isError: true }) as never,
      });
      const d = new McpToolDispatcher(errorManager);

      const result = await d.execute({
        id: "call-5",
        name: "mcp__memory__read",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.output).toBe("connection error");
    });
  });
});
