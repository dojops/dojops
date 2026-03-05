import { describe, it, expect } from "vitest";
import {
  Context7LibraryRefSchema,
  ContextBlockSchema,
  FileSpecV2Schema,
  DopsFrontmatterV2Schema,
  DopsModule,
  DopsModuleV2,
  isV2Module,
} from "../spec";

describe("Context7LibraryRefSchema", () => {
  it("validates a valid library ref", () => {
    const result = Context7LibraryRefSchema.safeParse({
      name: "terraform",
      query: "How to create S3 bucket",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      name: "terraform",
      query: "How to create S3 bucket",
    });
  });

  it("rejects empty name", () => {
    const result = Context7LibraryRefSchema.safeParse({
      name: "",
      query: "Some query",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty query", () => {
    const result = Context7LibraryRefSchema.safeParse({
      name: "terraform",
      query: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name field", () => {
    const result = Context7LibraryRefSchema.safeParse({
      query: "Some query",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing query field", () => {
    const result = Context7LibraryRefSchema.safeParse({
      name: "terraform",
    });
    expect(result.success).toBe(false);
  });
});

describe("ContextBlockSchema", () => {
  it("validates a complete context block", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Terraform",
      fileFormat: "hcl",
      outputGuidance: "Generate valid HCL code.",
      bestPractices: ["Use modules", "Tag all resources"],
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      technology: "Terraform",
      fileFormat: "hcl",
      outputGuidance: "Generate valid HCL code.",
      bestPractices: ["Use modules", "Tag all resources"],
    });
  });

  it("validates with optional context7Libraries", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Kubernetes",
      fileFormat: "yaml",
      outputGuidance: "Generate K8s manifests.",
      bestPractices: ["Use resource limits"],
      context7Libraries: [{ name: "kubernetes", query: "Deployment spec" }],
    });
    expect(result.success).toBe(true);
    expect(result.data!.context7Libraries).toHaveLength(1);
  });

  it("rejects missing technology", () => {
    const result = ContextBlockSchema.safeParse({
      fileFormat: "yaml",
      outputGuidance: "Generate config.",
      bestPractices: ["Practice one"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fileFormat", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Test",
      outputGuidance: "Generate config.",
      bestPractices: ["Practice one"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid fileFormat", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Test",
      fileFormat: "xml",
      outputGuidance: "Generate config.",
      bestPractices: ["Practice one"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing outputGuidance", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Test",
      fileFormat: "yaml",
      bestPractices: ["Practice one"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty bestPractices array", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Test",
      fileFormat: "yaml",
      outputGuidance: "Generate config.",
      bestPractices: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects bestPractices with empty string entries", () => {
    const result = ContextBlockSchema.safeParse({
      technology: "Test",
      fileFormat: "yaml",
      outputGuidance: "Generate config.",
      bestPractices: [""],
    });
    expect(result.success).toBe(false);
  });
});

describe("FileSpecV2Schema", () => {
  it("validates a file spec with raw format", () => {
    const result = FileSpecV2Schema.safeParse({
      path: "output.yaml",
      format: "raw",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      path: "output.yaml",
      format: "raw",
    });
  });

  it("defaults format to raw when omitted", () => {
    const result = FileSpecV2Schema.safeParse({
      path: "output.yaml",
    });
    expect(result.success).toBe(true);
    expect(result.data!.format).toBe("raw");
  });

  it("validates with optional conditional", () => {
    const result = FileSpecV2Schema.safeParse({
      path: "optional.yaml",
      format: "raw",
      conditional: true,
    });
    expect(result.success).toBe(true);
    expect(result.data!.conditional).toBe(true);
  });

  it("rejects empty path", () => {
    const result = FileSpecV2Schema.safeParse({
      path: "",
      format: "raw",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-raw format", () => {
    const result = FileSpecV2Schema.safeParse({
      path: "output.yaml",
      format: "yaml",
    });
    expect(result.success).toBe(false);
  });
});

describe("DopsFrontmatterV2Schema", () => {
  const validFrontmatter = {
    dops: "v2",
    kind: "tool",
    meta: {
      name: "test-tool",
      version: "1.0.0",
      description: "A test tool",
    },
    context: {
      technology: "Terraform",
      fileFormat: "hcl",
      outputGuidance: "Generate valid HCL.",
      bestPractices: ["Use modules", "Tag resources"],
    },
    files: [{ path: "main.tf", format: "raw" }],
  };

  it("validates complete v2 frontmatter", () => {
    const result = DopsFrontmatterV2Schema.safeParse(validFrontmatter);
    expect(result.success).toBe(true);
    expect(result.data!.dops).toBe("v2");
    expect(result.data!.meta.name).toBe("test-tool");
    expect(result.data!.context.technology).toBe("Terraform");
    expect(result.data!.files).toHaveLength(1);
  });

  it("validates with optional fields", () => {
    const result = DopsFrontmatterV2Schema.safeParse({
      ...validFrontmatter,
      risk: { level: "MEDIUM", rationale: "Infra changes" },
      execution: { mode: "generate", deterministic: true, idempotent: false },
      permissions: { filesystem: "write", child_process: "none", network: "none" },
      scope: { write: ["*.tf"] },
    });
    expect(result.success).toBe(true);
    expect(result.data!.risk!.level).toBe("MEDIUM");
    expect(result.data!.execution!.deterministic).toBe(true);
  });

  it("rejects invalid version (v1 instead of v2)", () => {
    const result = DopsFrontmatterV2Schema.safeParse({
      ...validFrontmatter,
      dops: "v1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid version (arbitrary string)", () => {
    const result = DopsFrontmatterV2Schema.safeParse({
      ...validFrontmatter,
      dops: "v3",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing context block", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { context: _context, ...noContext } = validFrontmatter;
    const result = DopsFrontmatterV2Schema.safeParse(noContext);
    expect(result.success).toBe(false);
  });

  it("rejects missing files array", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { files: _files, ...noFiles } = validFrontmatter;
    const result = DopsFrontmatterV2Schema.safeParse(noFiles);
    expect(result.success).toBe(false);
  });

  it("rejects empty files array", () => {
    const result = DopsFrontmatterV2Schema.safeParse({
      ...validFrontmatter,
      files: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("isV2Module", () => {
  it("returns true for v2 modules", () => {
    const mod: DopsModuleV2 = {
      frontmatter: {
        dops: "v2",
        kind: "tool",
        meta: { name: "test", version: "1.0.0", description: "Test" },
        context: {
          technology: "Test",
          fileFormat: "yaml",
          outputGuidance: "Generate.",
          bestPractices: ["Practice"],
        },
        files: [{ path: "out.yaml", format: "raw" }],
      },
      sections: { prompt: "Test", keywords: "test" },
      raw: "",
    };
    expect(isV2Module(mod)).toBe(true);
  });

  it("returns false for v1 modules", () => {
    const mod: DopsModule = {
      frontmatter: {
        dops: "v1",
        kind: "tool",
        meta: { name: "test", version: "1.0.0", description: "Test" },
        output: { type: "object" },
        files: [{ path: "out.yaml", format: "yaml", source: "llm" }],
      },
      sections: { prompt: "Test", keywords: "test" },
      raw: "",
    };
    expect(isV2Module(mod)).toBe(false);
  });
});
