import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { discoverTools } from "../tool-loader";

/** Write a tool manifest + input schema to disk. */
function writeToolFiles(
  dir: string,
  name: string,
  opts?: {
    manifestFilename?: string;
    descriptionSuffix?: string;
    overrides?: Record<string, unknown>;
  },
) {
  const toolDir = path.join(dir, name);
  fs.mkdirSync(toolDir, { recursive: true });

  const manifest = {
    spec: 1,
    name,
    version: "1.0.0",
    type: "tool",
    description: `Test ${name} ${opts?.descriptionSuffix ?? "tool"}`,
    inputSchema: "input.schema.json",
    generator: {
      strategy: "llm",
      systemPrompt: "Generate config.",
    },
    files: [{ path: "output.yaml", serializer: "yaml" }],
    ...opts?.overrides,
  };

  const filename = opts?.manifestFilename ?? "tool.yaml";
  fs.writeFileSync(path.join(toolDir, filename), yaml.dump(manifest), "utf-8");

  const inputSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
    },
    required: ["name"],
  };

  fs.writeFileSync(
    path.join(toolDir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2),
    "utf-8",
  );

  return toolDir;
}

function createTestTool(dir: string, name: string, overrides?: Record<string, unknown>) {
  return writeToolFiles(dir, name, { overrides });
}

function createLegacyPlugin(dir: string, name: string, overrides?: Record<string, unknown>) {
  return writeToolFiles(dir, name, {
    manifestFilename: "plugin.yaml",
    descriptionSuffix: "legacy plugin",
    overrides,
  });
}

describe("discoverTools", () => {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tool-test-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no tools exist", () => {
    const tools = discoverTools(projectDir);
    expect(tools).toEqual([]);
  });

  it("discovers global tools from ~/.dojops/tools/", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "global-tool");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("global-tool");
    expect(tools[0].source.location).toBe("global");
  });

  it("discovers project tools from .dojops/tools/", () => {
    const projectToolsDir = path.join(projectDir, ".dojops", "tools");
    fs.mkdirSync(projectToolsDir, { recursive: true });
    createTestTool(projectToolsDir, "project-tool");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("project-tool");
    expect(tools[0].source.location).toBe("project");
  });

  it("project tools override global tools with same name", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "shared-tool", { version: "1.0.0" });

    const projectToolsDir = path.join(projectDir, ".dojops", "tools");
    fs.mkdirSync(projectToolsDir, { recursive: true });
    createTestTool(projectToolsDir, "shared-tool", { version: "2.0.0" });

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("shared-tool");
    expect(tools[0].manifest.version).toBe("2.0.0");
    expect(tools[0].source.location).toBe("project");
  });

  it("discovers both global and project tools with different names", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "tool-a");

    const projectToolsDir = path.join(projectDir, ".dojops", "tools");
    fs.mkdirSync(projectToolsDir, { recursive: true });
    createTestTool(projectToolsDir, "tool-b");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.manifest.name).sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(["tool-a", "tool-b"]);
  });

  it("skips directories without tool.yaml", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(path.join(globalToolsDir, "empty-dir"), { recursive: true });

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(0);
  });

  it("skips invalid manifests", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    const invalidDir = path.join(globalToolsDir, "bad-tool");
    fs.mkdirSync(invalidDir, { recursive: true });
    fs.writeFileSync(path.join(invalidDir, "tool.yaml"), "this is not valid yaml: [", "utf-8");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(0);
  });

  it("skips tools with missing input schema file", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    const toolDir = path.join(globalToolsDir, "no-schema");
    fs.mkdirSync(toolDir, { recursive: true });

    const manifest = {
      spec: 1,
      name: "no-schema",
      version: "1.0.0",
      type: "tool",
      description: "Missing schema",
      inputSchema: "input.schema.json",
      generator: { strategy: "llm", systemPrompt: "test" },
      files: [{ path: "out.yaml", serializer: "yaml" }],
    };
    fs.writeFileSync(path.join(toolDir, "tool.yaml"), yaml.dump(manifest), "utf-8");
    // Intentionally do NOT create input.schema.json

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(0);
  });

  it("computes tool hash", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "hash-tool");

    const tools = discoverTools(projectDir);
    expect(tools[0].source.toolHash).toBeDefined();
    expect(tools[0].source.toolHash!.length).toBe(64); // SHA-256 hex
  });

  it("works without projectPath", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "global-only");

    const tools = discoverTools(); // no project path
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("global-only");
  });

  // Backward compatibility tests
  it("discovers tools from legacy plugins/ directories", () => {
    const globalPluginsDir = path.join(tmpDir, ".dojops", "plugins");
    fs.mkdirSync(globalPluginsDir, { recursive: true });
    createLegacyPlugin(globalPluginsDir, "legacy-tool");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("legacy-tool");
  });

  it("discovers tools with legacy plugin.yaml manifest", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createLegacyPlugin(globalToolsDir, "legacy-manifest");

    const tools = discoverTools(projectDir);
    expect(tools).toHaveLength(1);
    expect(tools[0].manifest.name).toBe("legacy-manifest");
  });

  it("source type is 'custom'", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "type-test");

    const tools = discoverTools(projectDir);
    expect(tools[0].source.type).toBe("custom");
  });
});
