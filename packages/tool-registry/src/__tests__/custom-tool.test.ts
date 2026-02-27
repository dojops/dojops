import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CustomTool, isVerificationCommandAllowed } from "../custom-tool";
import { ToolManifest, ToolSource } from "../types";
import { LLMProvider, LLMRequest, LLMResponse } from "@dojops/core";

function createMockProvider(response: Partial<LLMResponse> = {}): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify({ key: "value", setting: true }),
      parsed: { key: "value", setting: true },
      ...response,
    }),
  };
}

function createTestManifest(overrides?: Partial<ToolManifest>): ToolManifest {
  return {
    spec: 1,
    name: "test-tool",
    version: "1.0.0",
    type: "tool",
    description: "A test tool",
    inputSchema: "input.schema.json",
    generator: {
      strategy: "llm",
      systemPrompt: "Generate test configuration.",
    },
    files: [{ path: "{outputPath}/config.yaml", serializer: "yaml" }],
    ...overrides,
  };
}

const testSource: ToolSource = {
  type: "custom",
  location: "project",
  toolPath: "/test",
  toolVersion: "1.0.0",
  toolHash: "abc123",
};

const testInputSchema = {
  type: "object",
  properties: {
    outputPath: { type: "string", description: "Output directory" },
    description: { type: "string", description: "What to generate" },
  },
  required: ["outputPath", "description"],
};

describe("CustomTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-custom-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates tool with correct name and description", () => {
    const provider = createMockProvider();
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    expect(tool.name).toBe("test-tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.source).toEqual(testSource);
  });

  it("validates input against JSON-derived schema", () => {
    const provider = createMockProvider();
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    expect(tool.validate({ outputPath: "/tmp", description: "test" }).valid).toBe(true);
    expect(tool.validate({ outputPath: "/tmp" }).valid).toBe(false); // missing required
    expect(tool.validate("invalid").valid).toBe(false);
  });

  it("generates using LLM provider", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.generate({ outputPath: tmpDir, description: "test config" });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as Record<string, unknown>).generated).toEqual({
      key: "value",
      setting: true,
    });
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it("generate builds user prompt from input", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    await tool.generate({ outputPath: "/out", description: "make config" });

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMRequest;
    expect(call.system).toContain("Generate test configuration.");
    expect(call.prompt).toContain("outputPath: /out");
    expect(call.prompt).toContain("description: make config");
  });

  it("generate handles update mode with existingContent input", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest({
      generator: {
        strategy: "llm",
        systemPrompt: "Generate config.",
        updateMode: true,
      },
    });
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.generate({
      outputPath: tmpDir,
      description: "test",
      existingContent: "existing: content",
    });

    expect(result.success).toBe(true);
    const data = result.data as { isUpdate: boolean };
    expect(data.isUpdate).toBe(true);

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMRequest;
    expect(call.system).toContain("UPDATING");
    expect(call.system).toContain("existing: content");
  });

  it("generate handles LLM failure", async () => {
    const provider = createMockProvider();
    (provider.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("API error"));
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.generate({ outputPath: tmpDir, description: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("API error");
  });

  it("execute writes files to disk", async () => {
    const provider = createMockProvider();
    const outputDir = path.join(tmpDir, "output");
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, outputDir, testSource, testInputSchema);

    const result = await tool.execute({ outputPath: outputDir, description: "test" });

    expect(result.success).toBe(true);
    const filePath = path.join(outputDir, "config.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("key: value");
  });

  it("execute creates backup on update", async () => {
    const provider = createMockProvider();
    const outputDir = path.join(tmpDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, "config.yaml");
    fs.writeFileSync(filePath, "old: content", "utf-8");

    const manifest = createTestManifest({
      generator: {
        strategy: "llm",
        systemPrompt: "Generate config.",
        updateMode: true,
      },
      detector: { path: "{outputPath}/config.yaml" },
    });

    const tool = new CustomTool(manifest, provider, outputDir, testSource, testInputSchema);

    const result = await tool.execute({
      outputPath: outputDir,
      description: "update",
      existingContent: "old: content",
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(`${filePath}.bak`)).toBe(true);
    expect(fs.readFileSync(`${filePath}.bak`, "utf-8")).toBe("old: content");
  });

  it("verify returns passed when no verification command", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest(); // no verification field
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.verify({});
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("generates with non-parsed LLM response (falls back to JSON.parse)", async () => {
    const provider = createMockProvider({
      content: '{"fallback": true}',
      parsed: undefined,
    });
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.generate({ outputPath: tmpDir, description: "test" });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).generated).toEqual({ fallback: true });
  });

  it("generates with non-JSON LLM response (raw string)", async () => {
    const provider = createMockProvider({
      content: "raw text output",
      parsed: undefined,
    });
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.generate({ outputPath: tmpDir, description: "test" });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).generated).toBe("raw text output");
  });

  it("exposes systemPromptHash as SHA-256 of system prompt", () => {
    const provider = createMockProvider();
    const manifest = createTestManifest();
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const hash = tool.systemPromptHash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Same manifest → same hash
    const tool2 = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);
    expect(tool2.systemPromptHash).toBe(hash);
  });
});

describe("isVerificationCommandAllowed", () => {
  it("allows whitelisted binary with args", () => {
    expect(isVerificationCommandAllowed("terraform validate -json")).toBe(true);
  });

  it("allows exact whitelisted binary name", () => {
    expect(isVerificationCommandAllowed("kubectl")).toBe(true);
  });

  it("rejects non-whitelisted command", () => {
    expect(isVerificationCommandAllowed("rm -rf /")).toBe(false);
  });

  it("rejects prefix tricks (e.g. terraformx)", () => {
    expect(isVerificationCommandAllowed("terraformx validate")).toBe(false);
  });

  it("handles leading whitespace", () => {
    expect(isVerificationCommandAllowed("  helm lint")).toBe(true);
  });
});

describe("verify() permission enforcement", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-verify-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips execution when child_process is 'none'", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest({
      verification: { command: "terraform validate" },
      permissions: { child_process: "none" },
    });
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.verify({});
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("skips execution when permissions are undefined (default-safe)", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest({
      verification: { command: "terraform validate" },
      // no permissions field at all
    });
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.verify({});
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects non-whitelisted command even with child_process required", async () => {
    const provider = createMockProvider();
    const manifest = createTestManifest({
      verification: { command: "curl http://evil.com" },
      permissions: { child_process: "required" },
    });
    const tool = new CustomTool(manifest, provider, tmpDir, testSource, testInputSchema);

    const result = await tool.verify({});
    expect(result.passed).toBe(false);
    expect(result.issues[0].message).toContain("not in the allowed binaries whitelist");
  });
});
