import { describe, it, expect } from "vitest";
import { McpConfigSchema } from "../types";

describe("McpConfigSchema", () => {
  describe("stdio server config", () => {
    it("accepts valid stdio config", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          filesystem: {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts stdio config with env", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          myserver: {
            transport: "stdio",
            command: "node",
            args: ["server.js"],
            env: { NODE_ENV: "production", API_KEY: "secret" },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts stdio config without optional fields", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          minimal: { transport: "stdio", command: "echo" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects stdio config with empty command", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          bad: { transport: "stdio", command: "" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects stdio config without command", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          bad: { transport: "stdio" },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("HTTP server config", () => {
    it("accepts valid HTTP config", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          remote: {
            transport: "streamable-http",
            url: "https://mcp.example.com/v1",
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts HTTP config with headers", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          authed: {
            transport: "streamable-http",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer tok_123" },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects HTTP config with invalid URL", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          bad: { transport: "streamable-http", url: "not-a-url" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects HTTP config without url", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          bad: { transport: "streamable-http" },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("general validation", () => {
    it("accepts empty mcpServers", () => {
      const result = McpConfigSchema.safeParse({ mcpServers: {} });
      expect(result.success).toBe(true);
    });

    it("accepts multiple servers of mixed types", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          local: { transport: "stdio", command: "node", args: ["server.js"] },
          cloud: {
            transport: "streamable-http",
            url: "https://mcp.cloud.io/api",
            headers: { "X-Api-Key": "key123" },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown transport type", () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          bad: { transport: "websocket", url: "ws://localhost:8080" },
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing mcpServers key", () => {
      const result = McpConfigSchema.safeParse({ servers: {} });
      expect(result.success).toBe(false);
    });

    it("rejects non-object root", () => {
      const result = McpConfigSchema.safeParse("not an object");
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = McpConfigSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });
});
