import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { discoverTools } from "../tool-loader";
import { CustomTool } from "../custom-tool";
import { ToolRegistry } from "../registry";
import { ToolManifest, ToolSource } from "../types";
import { LLMProvider } from "@dojops/core";

function createTestTool(dir: string, name: string, overrides?: Record<string, unknown>) {
  const toolDir = path.join(dir, name);
  fs.mkdirSync(toolDir, { recursive: true });

  const manifest = {
    spec: 1,
    name,
    version: "1.0.0",
    type: "tool",
    description: `Test ${name} tool`,
    inputSchema: "input.schema.json",
    generator: {
      strategy: "llm",
      systemPrompt: "Generate config for testing.",
    },
    files: [{ path: "output.yaml", serializer: "yaml" }],
    ...overrides,
  };

  fs.writeFileSync(path.join(toolDir, "tool.yaml"), yaml.dump(manifest), "utf-8");

  const inputSchema = {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  };

  fs.writeFileSync(
    path.join(toolDir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2),
    "utf-8",
  );

  return toolDir;
}

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn(async () => ({ content: "{}" })),
  };
}

describe("Tool hash changes on manifest modification", () => {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-upgrade-test-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("hash changes when systemPrompt is modified", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "hash-test");

    const before = discoverTools(projectDir);
    const hashBefore = before[0].source.toolHash;

    // Modify the systemPrompt in the manifest
    const manifestPath = path.join(globalToolsDir, "hash-test", "tool.yaml");
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Record<string, unknown>;
    (manifest.generator as Record<string, unknown>).systemPrompt = "Modified prompt.";
    fs.writeFileSync(manifestPath, yaml.dump(manifest), "utf-8");

    const after = discoverTools(projectDir);
    const hashAfter = after[0].source.toolHash;

    expect(hashBefore).not.toBe(hashAfter);
  });

  it("hash changes when version is bumped", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "version-test");

    const before = discoverTools(projectDir);
    const hashBefore = before[0].source.toolHash;

    // Bump version
    const manifestPath = path.join(globalToolsDir, "version-test", "tool.yaml");
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Record<string, unknown>;
    manifest.version = "2.0.0";
    fs.writeFileSync(manifestPath, yaml.dump(manifest), "utf-8");

    const after = discoverTools(projectDir);
    const hashAfter = after[0].source.toolHash;

    expect(hashBefore).not.toBe(hashAfter);
  });

  it("hash is stable when nothing changes", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "stable-test");

    const first = discoverTools(projectDir);
    const second = discoverTools(projectDir);

    expect(first[0].source.toolHash).toBe(second[0].source.toolHash);
  });

  it("hash only covers tool.yaml (modifying input.schema.json does not change hash)", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "schema-test");

    const before = discoverTools(projectDir);
    const hashBefore = before[0].source.toolHash;

    // Modify input.schema.json
    const schemaPath = path.join(globalToolsDir, "schema-test", "input.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    schema.properties.extra = { type: "number" };
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), "utf-8");

    const after = discoverTools(projectDir);
    const hashAfter = after[0].source.toolHash;

    expect(hashBefore).toBe(hashAfter);
  });
});

describe("Tool upgrade simulation", () => {
  let tmpDir: string;
  let projectDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-upgrade-sim-"));
    projectDir = path.join(tmpDir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects hash mismatch between saved plan hash and current tool hash", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "upgrade-tool");

    const before = discoverTools(projectDir);
    const savedHash = before[0].source.toolHash;

    // Simulate upgrade: modify manifest
    const manifestPath = path.join(globalToolsDir, "upgrade-tool", "tool.yaml");
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Record<string, unknown>;
    manifest.version = "2.0.0";
    (manifest.generator as Record<string, unknown>).systemPrompt = "Upgraded system prompt.";
    fs.writeFileSync(manifestPath, yaml.dump(manifest), "utf-8");

    const after = discoverTools(projectDir);
    const currentHash = after[0].source.toolHash;

    expect(savedHash).not.toBe(currentHash);
    expect(after[0].manifest.version).toBe("2.0.0");
  });

  it("detects missing tool when tool directory is deleted", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "removed-tool");

    const before = discoverTools(projectDir);
    expect(before).toHaveLength(1);

    // Remove the tool
    fs.rmSync(path.join(globalToolsDir, "removed-tool"), { recursive: true, force: true });

    const after = discoverTools(projectDir);
    expect(after).toHaveLength(0);
  });

  it("detects systemPromptHash mismatch between two CustomTool instances", () => {
    const provider = createMockProvider();

    const manifestV1: ToolManifest = {
      spec: 1,
      name: "prompt-tool",
      version: "1.0.0",
      type: "tool",
      description: "Test",
      inputSchema: "input.schema.json",
      generator: { strategy: "llm", systemPrompt: "Original prompt." },
      files: [{ path: "out.yaml", serializer: "yaml" }],
    };

    const manifestV2: ToolManifest = {
      ...manifestV1,
      version: "2.0.0",
      generator: { strategy: "llm", systemPrompt: "Changed prompt." },
    };

    const source: ToolSource = {
      type: "custom",
      location: "project",
      toolVersion: "1.0.0",
      toolHash: "abc123",
    };

    const inputSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };

    const toolV1 = new CustomTool(manifestV1, provider, "/tmp", source, inputSchema);
    const toolV2 = new CustomTool(
      manifestV2,
      provider,
      "/tmp",
      { ...source, toolVersion: "2.0.0" },
      inputSchema,
    );

    expect(toolV1.systemPromptHash).not.toBe(toolV2.systemPromptHash);
    expect(toolV1.systemPromptHash.length).toBe(64);
    expect(toolV2.systemPromptHash.length).toBe(64);
  });

  it("version string change is visible in ToolSource after re-discovery", () => {
    const globalToolsDir = path.join(tmpDir, ".dojops", "tools");
    fs.mkdirSync(globalToolsDir, { recursive: true });
    createTestTool(globalToolsDir, "versioned-tool", { version: "1.0.0" });

    const before = discoverTools(projectDir);
    expect(before[0].source.toolVersion).toBe("1.0.0");

    // Bump version
    const manifestPath = path.join(globalToolsDir, "versioned-tool", "tool.yaml");
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = yaml.load(content) as Record<string, unknown>;
    manifest.version = "1.1.0";
    fs.writeFileSync(manifestPath, yaml.dump(manifest), "utf-8");

    const after = discoverTools(projectDir);
    expect(after[0].source.toolVersion).toBe("1.1.0");
  });
});

describe("ToolRegistry metadata integration", () => {
  it("getToolMetadata returns systemPromptHash for custom tools", () => {
    const provider = createMockProvider();

    const manifest: ToolManifest = {
      spec: 1,
      name: "meta-tool",
      version: "1.0.0",
      type: "tool",
      description: "Test",
      inputSchema: "input.schema.json",
      generator: { strategy: "llm", systemPrompt: "Test prompt for metadata." },
      files: [{ path: "out.yaml", serializer: "yaml" }],
    };

    const source: ToolSource = {
      type: "custom",
      location: "project",
      toolVersion: "1.0.0",
      toolHash: "deadbeef",
    };

    const inputSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };

    const customTool = new CustomTool(manifest, provider, "/tmp", source, inputSchema);
    const registry = new ToolRegistry([], [customTool]);

    const metadata = registry.getToolMetadata("meta-tool");
    expect(metadata).toBeDefined();
    expect(metadata!.toolType).toBe("custom");
    expect(metadata!.systemPromptHash).toBe(customTool.systemPromptHash);
    expect(metadata!.toolVersion).toBe("1.0.0");
    expect(metadata!.toolHash).toBe("deadbeef");
  });

  it("getToolMetadata returns built-in type without systemPromptHash", () => {
    const registry = new ToolRegistry(
      [
        {
          name: "terraform",
          description: "Terraform tool",
          inputSchema: {} as never,
          validate: () => ({ valid: true }),
          generate: async () => ({ success: true, data: {} }),
        },
      ],
      [],
    );

    const metadata = registry.getToolMetadata("terraform");
    expect(metadata).toBeDefined();
    expect(metadata!.toolType).toBe("built-in");
    expect(metadata!.systemPromptHash).toBeUndefined();
  });

  it("getToolMetadata returns undefined for unknown tool", () => {
    const registry = new ToolRegistry([], []);
    expect(registry.getToolMetadata("nonexistent")).toBeUndefined();
  });
});
