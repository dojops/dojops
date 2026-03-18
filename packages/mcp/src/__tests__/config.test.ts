import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadMcpConfig, saveMcpConfig } from "../config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadMcpConfig", () => {
  it("returns empty config when no files exist", () => {
    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers).toEqual({});
  });

  it("loads project config from .dojops/mcp.json", () => {
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
    expect(config.mcpServers.filesystem).toBeDefined();
    expect(config.mcpServers.filesystem.transport).toBe("stdio");
    expect((config.mcpServers.filesystem as { command: string }).command).toBe("npx");
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
            url: "http://localhost:8080/mcp",
            headers: { Authorization: "Bearer token" },
          },
        },
      }),
    );

    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers.remote).toBeDefined();
    expect(config.mcpServers.remote.transport).toBe("streamable-http");
    expect((config.mcpServers.remote as { url: string }).url).toBe("http://localhost:8080/mcp");
  });

  it("returns empty config for invalid JSON", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "mcp.json"), "not json");

    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers).toEqual({});
  });

  it("returns empty config for invalid schema", () => {
    const configDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "mcp.json"),
      JSON.stringify({ mcpServers: { bad: { transport: "invalid" } } }),
    );

    const config = loadMcpConfig(tmpDir);
    expect(config.mcpServers).toEqual({});
  });

  it("merges project over global config", () => {
    // Create global config
    const globalDir = path.join(os.homedir(), ".dojops");
    const globalPath = path.join(globalDir, "mcp.json");
    const hadGlobal = fs.existsSync(globalPath);
    let globalBackup: string | undefined;
    if (hadGlobal) globalBackup = fs.readFileSync(globalPath, "utf-8");

    try {
      fs.mkdirSync(globalDir, { recursive: true });
      fs.writeFileSync(
        globalPath,
        JSON.stringify({
          mcpServers: {
            shared: { transport: "stdio", command: "global-cmd" },
            globalOnly: { transport: "stdio", command: "global-only" },
          },
        }),
      );

      // Create project config
      const projectDir = path.join(tmpDir, ".dojops");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            shared: { transport: "stdio", command: "project-cmd" },
            projectOnly: { transport: "stdio", command: "project-only" },
          },
        }),
      );

      const config = loadMcpConfig(tmpDir);

      // Project overrides global
      expect((config.mcpServers.shared as { command: string }).command).toBe("project-cmd");
      // Global-only preserved
      expect(config.mcpServers.globalOnly).toBeDefined();
      // Project-only preserved
      expect(config.mcpServers.projectOnly).toBeDefined();
    } finally {
      // Restore global config
      if (globalBackup !== undefined) {
        fs.writeFileSync(globalPath, globalBackup);
      } else if (!hadGlobal) {
        try {
          fs.unlinkSync(globalPath);
        } catch {
          /* noop */
        }
      }
    }
  });
});

describe("saveMcpConfig", () => {
  it("writes config to .dojops/mcp.json", () => {
    saveMcpConfig(tmpDir, {
      mcpServers: {
        test: { transport: "stdio", command: "echo" },
      },
    });

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, ".dojops", "mcp.json"), "utf-8"));
    expect(saved.mcpServers.test.command).toBe("echo");
  });

  it("creates .dojops directory if missing", () => {
    saveMcpConfig(tmpDir, { mcpServers: {} });
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "mcp.json"))).toBe(true);
  });
});
