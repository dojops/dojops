import { describe, it, expect, vi } from "vitest";
import { DopsRuntime } from "../runtime";
import { parseDopsString } from "../parser";
import type { LLMProvider } from "@dojops/core";

const SIMPLE_DOPS = `---
dops: v1
meta:
  name: simple-tool
  version: 1.0.0
  description: "A simple test tool"
input:
  fields:
    name:
      type: string
      required: true
    outputPath:
      type: string
      required: true
output:
  type: object
  required: [result]
  properties:
    result:
      type: string
    items:
      type: array
      items:
        type: string
files:
  - path: "{outputPath}/output.yaml"
    format: yaml
verification:
  structural:
    - path: "result"
      required: true
      message: "Result is required"
---
# Simple Tool

## Prompt

You are a simple tool. Generate config for {name}.

## Constraints

- Return valid JSON
- Include a result field

## Keywords

simple, test
`;

function createMockProvider(response: unknown): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(response),
      parsed: response,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
  };
}

describe("DopsRuntime", () => {
  it("initializes with correct name and description", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.name).toBe("simple-tool");
    expect(runtime.description).toBe("A simple test tool");
  });

  it("validates input correctly", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.validate({ name: "test", outputPath: "/tmp" }).valid).toBe(true);
    expect(runtime.validate({}).valid).toBe(false);
  });

  it("generates output via LLM", async () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const mockData = { result: "generated config", items: ["a", "b"] };
    const provider = createMockProvider(mockData);
    const runtime = new DopsRuntime(module, provider);

    const result = await runtime.generate({ name: "test", outputPath: "/tmp" });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as { generated: unknown; isUpdate: boolean };
    expect(data.generated).toEqual(mockData);
    expect(data.isUpdate).toBe(false);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it("handles generate errors gracefully", async () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockRejectedValue(new Error("LLM failed")),
    };
    const runtime = new DopsRuntime(module, provider);

    const result = await runtime.generate({ name: "test", outputPath: "/tmp" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("LLM failed");
  });

  it("runs structural verification", async () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    // Data missing required "result" field
    const result = await runtime.verify({ items: ["a"] });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message === "Result is required")).toBe(true);
  });

  it("passes structural verification with valid data", async () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    const result = await runtime.verify({ result: "ok" });
    expect(result.passed).toBe(true);
  });

  it("computes systemPromptHash", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.systemPromptHash).toBeDefined();
    expect(runtime.systemPromptHash.length).toBe(64); // SHA-256 hex
  });

  it("computes moduleHash", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.moduleHash).toBeDefined();
    expect(runtime.moduleHash.length).toBe(64);
  });

  it("returns metadata", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    const meta = runtime.metadata;
    expect(meta.toolType).toBe("built-in");
    expect(meta.toolVersion).toBe("1.0.0");
    expect(meta.toolSource).toBe("dops");
    expect(meta.systemPromptHash).toBeDefined();
    expect(meta.icon).toBeUndefined();
  });

  it("includes icon in metadata when declared", () => {
    const dops = `---
dops: v1
meta:
  name: icon-tool
  version: 1.0.0
  description: "Tool with icon"
  icon: "https://registry.dojops.ai/icons/my-tool.svg"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "out.yaml"
---
## Prompt

Generate.

## Keywords

test
`;
    const module = parseDopsString(dops);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.metadata.icon).toBe("https://registry.dojops.ai/icons/my-tool.svg");
  });

  it("extracts keywords", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.keywords).toEqual(["simple", "test"]);
  });

  it("returns default risk when not declared", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.risk).toEqual({
      level: "LOW",
      rationale: "No risk classification declared",
    });
  });

  it("returns declared risk", () => {
    const dops = `---
dops: v1
meta:
  name: risky-tool
  version: 1.0.0
  description: "Risky tool"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "out.yaml"
risk:
  level: HIGH
  rationale: "Modifies production resources"
---
## Prompt

Generate.

## Keywords

test
`;
    const module = parseDopsString(dops);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.risk.level).toBe("HIGH");
    expect(runtime.risk.rationale).toBe("Modifies production resources");
  });

  it("includes riskLevel in metadata", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.metadata.riskLevel).toBe("LOW");
  });

  it("returns default executionMode when not declared", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.executionMode).toEqual({
      mode: "generate",
      deterministic: false,
      idempotent: false,
    });
  });

  it("returns declared executionMode", () => {
    const dops = `---
dops: v1
meta:
  name: exec-tool
  version: 1.0.0
  description: "Exec tool"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "out.yaml"
execution:
  mode: update
  deterministic: true
  idempotent: true
---
## Prompt

Generate.

## Keywords

test
`;
    const module = parseDopsString(dops);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.executionMode.mode).toBe("update");
    expect(runtime.isDeterministic).toBe(true);
    expect(runtime.isIdempotent).toBe(true);
  });

  it("isDeterministic and isIdempotent default to false", () => {
    const module = parseDopsString(SIMPLE_DOPS);
    const provider = createMockProvider({});
    const runtime = new DopsRuntime(module, provider);

    expect(runtime.isDeterministic).toBe(false);
    expect(runtime.isIdempotent).toBe(false);
  });

  it("uses update prompt when existingContent is provided", async () => {
    const dops = `---
dops: v1
meta:
  name: update-tool
  version: 1.0.0
  description: "Update tool"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "out.yaml"
---
## Prompt

Generate new config.

## Update Prompt

Update existing: {existingContent}

## Keywords

test
`;
    const module = parseDopsString(dops);
    const mockData = { result: "updated" };
    const provider = createMockProvider(mockData);
    const runtime = new DopsRuntime(module, provider);

    await runtime.generate({ existingContent: "old stuff" });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.system).toContain("Update existing: old stuff");
    expect(call.system).not.toContain("Generate new config.");
  });
});
