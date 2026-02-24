import { describe, it, expect } from "vitest";
import { validateManifest } from "../manifest-schema";

describe("validateManifest", () => {
  const validManifest = {
    spec: 1,
    name: "my-tool",
    version: "1.0.0",
    type: "tool",
    description: "A test tool",
    inputSchema: "input.schema.json",
    generator: {
      strategy: "llm",
      systemPrompt: "You are a configuration expert.",
    },
    files: [{ path: "output.yaml", serializer: "yaml" }],
  };

  it("accepts a valid minimal manifest", () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.name).toBe("my-tool");
  });

  it("accepts a manifest with all optional fields", () => {
    const full = {
      ...validManifest,
      outputSchema: "output.schema.json",
      tags: ["devops", "ci"],
      generator: {
        ...validManifest.generator,
        updateMode: true,
        existingDelimiter: "---",
      },
      verification: { command: "validate.sh" },
      detector: { path: "config.yaml" },
      permissions: {
        filesystem: "project",
        network: "none",
        child_process: "required",
      },
    };
    const result = validateManifest(full);
    expect(result.valid).toBe(true);
    expect(result.manifest!.tags).toEqual(["devops", "ci"]);
  });

  it("rejects missing name", () => {
    const noName = { ...validManifest };
    delete (noName as Record<string, unknown>).name;
    const result = validateManifest(noName);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  it("rejects invalid name (uppercase)", () => {
    const result = validateManifest({ ...validManifest, name: "MyTool" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  it("rejects invalid name (spaces)", () => {
    const result = validateManifest({ ...validManifest, name: "my tool" });
    expect(result.valid).toBe(false);
  });

  it("rejects wrong spec version", () => {
    const result = validateManifest({ ...validManifest, spec: 2 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("spec");
  });

  it("rejects spec version 0", () => {
    const result = validateManifest({ ...validManifest, spec: 0 });
    expect(result.valid).toBe(false);
  });

  it("rejects wrong type", () => {
    const result = validateManifest({ ...validManifest, type: "service" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("type");
  });

  it("rejects missing description", () => {
    const noDesc = { ...validManifest };
    delete (noDesc as Record<string, unknown>).description;
    const result = validateManifest(noDesc);
    expect(result.valid).toBe(false);
  });

  it("rejects missing generator", () => {
    const noGen = { ...validManifest };
    delete (noGen as Record<string, unknown>).generator;
    const result = validateManifest(noGen);
    expect(result.valid).toBe(false);
  });

  it("rejects empty files array", () => {
    const result = validateManifest({ ...validManifest, files: [] });
    expect(result.valid).toBe(false);
  });

  it("rejects invalid serializer", () => {
    const result = validateManifest({
      ...validManifest,
      files: [{ path: "out.txt", serializer: "xml" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects missing inputSchema", () => {
    const noSchema = { ...validManifest };
    delete (noSchema as Record<string, unknown>).inputSchema;
    const result = validateManifest(noSchema);
    expect(result.valid).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest("string").valid).toBe(false);
    expect(validateManifest(42).valid).toBe(false);
  });

  it("rejects invalid permissions values", () => {
    const result = validateManifest({
      ...validManifest,
      permissions: { filesystem: "invalid" },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts all valid serializer types", () => {
    for (const serializer of ["yaml", "json", "hcl", "ini", "toml", "raw"]) {
      const result = validateManifest({
        ...validManifest,
        files: [{ path: "out", serializer }],
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects file path with '..' traversal", () => {
    const result = validateManifest({
      ...validManifest,
      files: [{ path: "../../etc/passwd", serializer: "raw" }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("traversal");
  });

  it("rejects embedded path traversal", () => {
    const result = validateManifest({
      ...validManifest,
      files: [{ path: "config/../../../secret", serializer: "yaml" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects detector path with '..' traversal", () => {
    const result = validateManifest({
      ...validManifest,
      detector: { path: "../outside/config.yaml" },
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("traversal");
  });

  it("accepts template path with placeholder", () => {
    const result = validateManifest({
      ...validManifest,
      files: [{ path: "{outputPath}/config.yaml", serializer: "yaml" }],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts detector path without traversal", () => {
    const result = validateManifest({
      ...validManifest,
      detector: { path: "config.yaml" },
    });
    expect(result.valid).toBe(true);
  });
});
