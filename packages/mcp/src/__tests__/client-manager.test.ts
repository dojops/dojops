import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClientManager } from "../client-manager";
import type { McpConfig } from "../types";

// Mock the MCP SDK with class-based mocks
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      connect = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({
        tools: [
          {
            name: "read_memory",
            description: "Read from memory store",
            inputSchema: { type: "object", properties: { key: { type: "string" } } },
          },
          {
            name: "write_memory",
            description: "Write to memory store",
            inputSchema: {
              type: "object",
              properties: { key: { type: "string" }, value: { type: "string" } },
            },
          },
        ],
      });
      callTool = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "tool result" }],
        isError: false,
      });
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioTransport {
    constructor() {
      /* noop */
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockHTTPTransport {
    constructor() {
      /* noop */
    }
  },
}));

describe("McpClientManager", () => {
  let manager: McpClientManager;

  beforeEach(() => {
    manager = new McpClientManager();
  });

  const stdioConfig: McpConfig = {
    mcpServers: {
      memory: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    },
  };

  const httpConfig: McpConfig = {
    mcpServers: {
      remote: {
        transport: "streamable-http",
        url: "http://localhost:8080/mcp",
      },
    },
  };

  describe("connectAll", () => {
    it("connects to stdio servers", async () => {
      await manager.connectAll(stdioConfig);
      expect(manager.getConnectedServers()).toEqual(["memory"]);
    });

    it("connects to HTTP servers", async () => {
      await manager.connectAll(httpConfig);
      expect(manager.getConnectedServers()).toEqual(["remote"]);
    });

    it("connects to multiple servers", async () => {
      await manager.connectAll({
        mcpServers: {
          ...stdioConfig.mcpServers,
          ...httpConfig.mcpServers,
        },
      });
      expect(manager.getConnectedServers()).toHaveLength(2);
    });

    it("handles empty config", async () => {
      await manager.connectAll({ mcpServers: {} });
      expect(manager.getConnectedServers()).toEqual([]);
    });
  });

  describe("getToolDefinitions", () => {
    it("returns namespaced tools from all servers", async () => {
      await manager.connectAll(stdioConfig);
      const tools = manager.getToolDefinitions();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("mcp__memory__read_memory");
      expect(tools[1].name).toBe("mcp__memory__write_memory");
      expect(tools[0].description).toContain("[MCP: memory]");
      expect(tools[0].parameters).toEqual({
        type: "object",
        properties: { key: { type: "string" } },
      });
    });

    it("returns empty array when no servers connected", () => {
      expect(manager.getToolDefinitions()).toEqual([]);
    });
  });

  describe("callTool", () => {
    it("calls tool on connected server", async () => {
      await manager.connectAll(stdioConfig);
      const result = await manager.callTool("memory", "read_memory", { key: "test" });

      expect(result.content).toBe("tool result");
      expect(result.isError).toBe(false);
    });

    it("returns error for unknown server", async () => {
      const result = await manager.callTool("nonexistent", "read_memory", {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain("not connected");
    });
  });

  describe("disconnectAll", () => {
    it("disconnects all servers", async () => {
      await manager.connectAll(stdioConfig);
      expect(manager.getConnectedServers()).toHaveLength(1);

      await manager.disconnectAll();
      expect(manager.getConnectedServers()).toEqual([]);
    });

    it("handles disconnect when no servers connected", async () => {
      await expect(manager.disconnectAll()).resolves.not.toThrow();
    });
  });
});
