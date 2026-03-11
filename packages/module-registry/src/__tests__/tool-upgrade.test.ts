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

let tmpDir: string;
let projectDir: string;
let globalToolsDir: string;
let origHome: string | undefined;

function setupTmpEnv() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-upgrade-test-"));
  projectDir = path.join(tmpDir, "project");
  fs.mkdirSync(projectDir, { recursive: true });
  globalToolsDir = path.join(tmpDir, ".dojops", "tools");
  fs.mkdirSync(globalToolsDir, { recursive: true });
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
}

function teardownTmpEnv() {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/** Modify a field in a tool's YAML manifest. */
function modifyManifest(toolName: string, mutate: (m: Record<string, unknown>) => void) {
  const manifestPath = path.join(globalToolsDir, toolName, "tool.yaml");
  const manifest = yaml.load(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
  mutate(manifest);
  fs.writeFileSync(manifestPath, yaml.dump(manifest), "utf-8");
}

describe("Tool hash changes on manifest modification", () => {
  beforeEach(setupTmpEnv);
  afterEach(teardownTmpEnv);

  it("hash changes when systemPrompt is modified", () => {
    createTestTool(globalToolsDir, "hash-test");
    const hashBefore = discoverTools(projectDir)[0].source.toolHash;
    modifyManifest("hash-test", (m) => {
      (m.generator as Record<string, unknown>).systemPrompt = "Modified prompt.";
    });
    expect(discoverTools(projectDir)[0].source.toolHash).not.toBe(hashBefore);
  });

  it("hash changes when version is bumped", () => {
    createTestTool(globalToolsDir, "version-test");
    const hashBefore = discoverTools(projectDir)[0].source.toolHash;
    modifyManifest("version-test", (m) => {
      m.version = "2.0.0";
    });
    expect(discoverTools(projectDir)[0].source.toolHash).not.toBe(hashBefore);
  });

  it("hash is stable when nothing changes", () => {
    createTestTool(globalToolsDir, "stable-test");
    expect(discoverTools(projectDir)[0].source.toolHash).toBe(
      discoverTools(projectDir)[0].source.toolHash,
    );
  });

  it("hash only covers tool.yaml (modifying input.schema.json does not change hash)", () => {
    createTestTool(globalToolsDir, "schema-test");
    const hashBefore = discoverTools(projectDir)[0].source.toolHash;
    const schemaPath = path.join(globalToolsDir, "schema-test", "input.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    schema.properties.extra = { type: "number" };
    fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2), "utf-8");
    expect(discoverTools(projectDir)[0].source.toolHash).toBe(hashBefore);
  });
});

describe("Tool upgrade simulation", () => {
  beforeEach(setupTmpEnv);
  afterEach(teardownTmpEnv);

  it("detects hash mismatch between saved plan hash and current tool hash", () => {
    createTestTool(globalToolsDir, "upgrade-tool");
    const savedHash = discoverTools(projectDir)[0].source.toolHash;
    modifyManifest("upgrade-tool", (m) => {
      m.version = "2.0.0";
      (m.generator as Record<string, unknown>).systemPrompt = "Upgraded system prompt.";
    });
    const after = discoverTools(projectDir);
    expect(after[0].source.toolHash).not.toBe(savedHash);
    expect(after[0].manifest.version).toBe("2.0.0");
  });

  it("detects missing tool when tool directory is deleted", () => {
    createTestTool(globalToolsDir, "removed-tool");
    expect(discoverTools(projectDir)).toHaveLength(1);
    fs.rmSync(path.join(globalToolsDir, "removed-tool"), { recursive: true, force: true });
    expect(discoverTools(projectDir)).toHaveLength(0);
  });

  it("detects systemPromptHash mismatch between two CustomTool instances", () => {
    const provider = createMockProvider();
    const mV1 = makeManifest({
      name: "prompt-tool",
      generator: { strategy: "llm", systemPrompt: "Original prompt." },
    });
    const mV2 = makeManifest({
      name: "prompt-tool",
      version: "2.0.0",
      generator: { strategy: "llm", systemPrompt: "Changed prompt." },
    });
    const source = makeSource();

    const toolV1 = new CustomTool(mV1, provider, "/tmp", source, DEFAULT_INPUT_SCHEMA);
    const toolV2 = new CustomTool(
      mV2,
      provider,
      "/tmp",
      { ...source, toolVersion: "2.0.0" },
      DEFAULT_INPUT_SCHEMA,
    );

    expect(toolV1.systemPromptHash).not.toBe(toolV2.systemPromptHash);
    expect(toolV1.systemPromptHash.length).toBe(64);
    expect(toolV2.systemPromptHash.length).toBe(64);
  });

  it("version string change is visible in ToolSource after re-discovery", () => {
    createTestTool(globalToolsDir, "versioned-tool", { version: "1.0.0" });
    expect(discoverTools(projectDir)[0].source.toolVersion).toBe("1.0.0");
    modifyManifest("versioned-tool", (m) => {
      m.version = "1.1.0";
    });
    expect(discoverTools(projectDir)[0].source.toolVersion).toBe("1.1.0");
  });
});

const DEFAULT_INPUT_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};

function makeManifest(overrides?: Partial<ToolManifest>): ToolManifest {
  return {
    spec: 1,
    name: "test-tool",
    version: "1.0.0",
    type: "tool",
    description: "Test",
    inputSchema: "input.schema.json",
    generator: { strategy: "llm", systemPrompt: "Test prompt." },
    files: [{ path: "out.yaml", serializer: "yaml" }],
    ...overrides,
  };
}

function makeSource(overrides?: Partial<ToolSource>): ToolSource {
  return {
    type: "custom",
    location: "project",
    toolVersion: "1.0.0",
    toolHash: "abc123",
    ...overrides,
  };
}

describe("ToolRegistry metadata integration", () => {
  it("getToolMetadata returns systemPromptHash for custom tools", () => {
    const provider = createMockProvider();
    const manifest = makeManifest({
      name: "meta-tool",
      generator: { strategy: "llm", systemPrompt: "Test prompt for metadata." },
    });
    const source = makeSource({ toolHash: "deadbeef" });
    const customTool = new CustomTool(manifest, provider, "/tmp", source, DEFAULT_INPUT_SCHEMA);
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
