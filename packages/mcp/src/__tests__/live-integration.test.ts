/**
 * Live integration test for MCP — connects to a real MCP server subprocess.
 * Uses @modelcontextprotocol/server-filesystem which provides file system tools.
 *
 * This test spawns a real process, so it's slower than unit tests (~2-5s).
 * Skipped by default — opt in locally with: MCP_LIVE=1 pnpm --filter @dojops/mcp test
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { McpClientManager } from "../client-manager";
import { McpToolDispatcher } from "../dispatcher";
import type { McpConfig } from "../types";

const SKIP = process.env.MCP_LIVE !== "1";

describe.skipIf(SKIP)("MCP Live Integration", () => {
  let manager: McpClientManager;
  let dispatcher: McpToolDispatcher;
  let testDir: string;
  let testFile: string;

  beforeAll(async () => {
    // Create a temp directory with a test file for the filesystem server to access
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-live-test-"));
    testFile = path.join(testDir, "hello.txt");
    fs.writeFileSync(testFile, "Hello from MCP live test!\n");

    manager = new McpClientManager();
    dispatcher = new McpToolDispatcher(manager);

    const config: McpConfig = {
      mcpServers: {
        filesystem: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", testDir],
        },
      },
    };

    await manager.connectAll(config);
  }, 30000); // npx download can be slow

  afterAll(async () => {
    await manager.disconnectAll();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("connects to the filesystem MCP server", () => {
    expect(manager.getConnectedServers()).toContain("filesystem");
    expect(dispatcher.isConnected()).toBe(true);
  });

  it("discovers tools from the server", () => {
    const tools = manager.getToolDefinitions();
    expect(tools.length).toBeGreaterThan(0);

    // All tools should be namespaced with mcp__filesystem__
    for (const tool of tools) {
      expect(tool.name).toMatch(/^mcp__filesystem__/);
      expect(tool.description).toContain("[MCP: filesystem]");
    }

    // The filesystem server should expose common file tools
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("mcp__filesystem__read_file");
    expect(toolNames).toContain("mcp__filesystem__list_directory");
  });

  it("dispatcher canHandle all discovered tools", () => {
    const tools = manager.getToolDefinitions();
    for (const tool of tools) {
      expect(dispatcher.canHandle(tool.name)).toBe(true);
    }
  });

  it("reads a file via MCP tool call", async () => {
    const result = await dispatcher.execute({
      id: "live-read-1",
      name: "mcp__filesystem__read_file",
      arguments: { path: testFile },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("Hello from MCP live test!");
    expect(result.callId).toBe("live-read-1");
  });

  it("lists a directory via MCP tool call", async () => {
    const result = await dispatcher.execute({
      id: "live-list-1",
      name: "mcp__filesystem__list_directory",
      arguments: { path: testDir },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello.txt");
  });

  it("returns error for non-existent file", async () => {
    const result = await manager.callTool("filesystem", "read_file", {
      path: path.join(testDir, "nonexistent.txt"),
    });

    // The server should return an error for missing files
    expect(result.isError).toBe(true);
  });

  it("returns error for non-existent server", async () => {
    const result = await dispatcher.execute({
      id: "live-bad-1",
      name: "mcp__nonexistent__some_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("not connected");
  });
});
