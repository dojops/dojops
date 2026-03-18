import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock node:os to control homedir() — ESM exports are non-configurable
const mockHomedir = vi.fn(() => os.tmpdir());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir() };
});

// Import after mock setup
import { loadMcpConfig, saveMcpConfig } from "../config";
import type { McpConfig } from "../types";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
  // Default: point homedir to nonexistent path (no global config)
  mockHomedir.mockReturnValue(path.join(tmpDir, "no-home"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadMcpConfig", () => {
  it("returns empty config when no files exist", () => {
    const config = loadMcpConfig(path.join(tmpDir, "no-project"));
    expect(config).toEqual({ mcpServers: {} });
  });

  it("loads project-level stdio config", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          filesystem: {
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
        },
      }),
    );

    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers.filesystem).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    });
  });

  it("loads HTTP server config", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          remote: {
            transport: "streamable-http",
            url: "https://mcp.example.com/v1",
            headers: { Authorization: "Bearer token123" },
          },
        },
      }),
    );

    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers.remote).toEqual({
      transport: "streamable-http",
      url: "https://mcp.example.com/v1",
      headers: { Authorization: "Bearer token123" },
    });
  });

  it("project config overrides global by server name", () => {
    // Set up global config
    const globalDir = path.join(tmpDir, "global-home");
    const globalMcpDir = path.join(globalDir, ".dojops");
    fs.mkdirSync(globalMcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalMcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { transport: "stdio", command: "global-cmd", args: ["--global"] },
          "global-only": { transport: "stdio", command: "only-in-global" },
        },
      }),
    );
    mockHomedir.mockReturnValue(globalDir);

    // Set up project config
    const projectDir = path.join(tmpDir, "project");
    const projectMcpDir = path.join(projectDir, ".dojops");
    fs.mkdirSync(projectMcpDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectMcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { transport: "stdio", command: "project-cmd", args: ["--project"] },
          "project-only": { transport: "stdio", command: "only-in-project" },
        },
      }),
    );

    const config = loadMcpConfig(projectDir);

    // Project overrides global for "shared"
    expect((config.mcpServers.shared as { command: string }).command).toBe("project-cmd");
    // Global-only server preserved
    expect(config.mcpServers["global-only"]).toBeDefined();
    // Project-only server preserved
    expect(config.mcpServers["project-only"]).toBeDefined();
    // Total: 3 servers
    expect(Object.keys(config.mcpServers)).toHaveLength(3);
  });

  it("returns empty config for invalid JSON file", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mcp.json"), "not valid json {{{");

    const config = loadMcpConfig(tmpDir);
    expect(config).toEqual({ mcpServers: {} });
  });

  it("returns empty config for invalid schema", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          bad: { transport: "unknown-transport", command: "test" },
        },
      }),
    );

    const config = loadMcpConfig(tmpDir);
    expect(config).toEqual({ mcpServers: {} });
  });

  it("handles empty mcpServers object", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mcp.json"), JSON.stringify({ mcpServers: {} }));

    const config = loadMcpConfig(tmpDir);
    expect(config).toEqual({ mcpServers: {} });
  });
});

describe("saveMcpConfig", () => {
  it("saves config to .dojops/mcp.json", () => {
    const config: McpConfig = {
      mcpServers: {
        test: { transport: "stdio", command: "echo", args: ["hello"] },
      },
    };

    saveMcpConfig(tmpDir, config);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".dojops", "mcp.json"), "utf-8"));
    expect(saved).toEqual(config);
  });

  it("creates .dojops directory if missing", () => {
    const newDir = path.join(tmpDir, "new-project");
    fs.mkdirSync(newDir);

    saveMcpConfig(newDir, { mcpServers: {} });

    expect(fs.existsSync(path.join(newDir, ".dojops", "mcp.json"))).toBe(true);
  });

  it("overwrites existing config", () => {
    const config1: McpConfig = {
      mcpServers: { a: { transport: "stdio", command: "first" } },
    };
    const config2: McpConfig = {
      mcpServers: { b: { transport: "stdio", command: "second" } },
    };

    saveMcpConfig(tmpDir, config1);
    saveMcpConfig(tmpDir, config2);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".dojops", "mcp.json"), "utf-8"));
    expect(saved).toEqual(config2);
    expect(saved.mcpServers).not.toHaveProperty("a");
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    saveMcpConfig(tmpDir, { mcpServers: {} });

    const raw = fs.readFileSync(path.join(tmpDir, ".dojops", "mcp.json"), "utf-8");
    expect(raw).toContain("  "); // indented
    expect(raw.endsWith("\n")).toBe(true);
  });
});
