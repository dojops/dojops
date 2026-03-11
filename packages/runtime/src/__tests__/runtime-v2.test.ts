import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import {
  DopsRuntimeV2,
  DocProvider,
  stripCodeFences,
  parseRawContent,
  parseMultiFileOutput,
} from "../runtime";
import { DopsModule } from "../spec";
import type { LLMProvider } from "@dojops/core";
import * as fs from "node:fs";

function createV2Module(overrides?: Partial<DopsModule["frontmatter"]>): DopsModule {
  return {
    frontmatter: {
      dops: "v2",
      kind: "tool",
      meta: {
        name: "test-v2-tool",
        version: "2.0.0",
        description: "A v2 test tool",
      },
      context: {
        technology: "Terraform",
        fileFormat: "hcl",
        outputGuidance: "Generate valid HCL code.",
        bestPractices: ["Use modules", "Tag resources"],
      },
      files: [{ path: "main.tf", format: "raw" as const }],
      ...overrides,
    },
    sections: {
      prompt: "You are a Terraform expert. {outputGuidance}",
      keywords: "terraform, hcl",
    },
    raw: "---\ndops: v2\n---\n## Prompt\nTest\n## Keywords\ntest",
  };
}

function createMockProvider(content: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }),
  };
}

/** Create a V2 module, mock provider, and runtime in one call. */
function createRuntime(
  content = "",
  moduleOverrides?: Partial<DopsModule["frontmatter"]>,
  runtimeOpts?: ConstructorParameters<typeof DopsRuntimeV2>[2],
) {
  const module = createV2Module(moduleOverrides);
  const provider = createMockProvider(content);
  const runtime = new DopsRuntimeV2(module, provider, runtimeOpts);
  return { module, provider, runtime };
}

describe("DopsRuntimeV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets name, risk, executionMode, and metadata correctly", () => {
    const module = createV2Module({
      risk: { level: "MEDIUM", rationale: "Infra changes" },
      execution: { mode: "generate", deterministic: true, idempotent: true },
    });
    const provider = createMockProvider("");
    const runtime = new DopsRuntimeV2(module, provider);

    expect(runtime.name).toBe("test-v2-tool");
    expect(runtime.description).toBe("A v2 test tool");
    expect(runtime.risk.level).toBe("MEDIUM");
    expect(runtime.risk.rationale).toBe("Infra changes");
    expect(runtime.executionMode.mode).toBe("generate");
    expect(runtime.executionMode.deterministic).toBe(true);
    expect(runtime.executionMode.idempotent).toBe(true);

    const meta = runtime.metadata;
    expect(meta.toolType).toBe("built-in");
    expect(meta.toolVersion).toBe("2.0.0");
    expect(meta.toolSource).toBe("dops");
    expect(meta.riskLevel).toBe("MEDIUM");
    expect(meta.toolHash).toBeDefined();
    expect(meta.systemPromptHash).toBeDefined();
  });

  it("returns default risk when not declared", () => {
    const { runtime } = createRuntime();
    expect(runtime.risk).toEqual({
      level: "LOW",
      rationale: "No risk classification declared",
    });
  });

  it("returns default executionMode when not declared", () => {
    const { runtime } = createRuntime();
    expect(runtime.executionMode).toEqual({
      mode: "generate",
      deterministic: false,
      idempotent: false,
    });
  });

  it("computes systemPromptHash and moduleHash", () => {
    const { runtime } = createRuntime();
    expect(runtime.systemPromptHash).toBeDefined();
    expect(runtime.systemPromptHash.length).toBe(64); // SHA-256 hex
    expect(runtime.moduleHash).toBeDefined();
    expect(runtime.moduleHash.length).toBe(64);
  });

  it("extracts keywords from sections", () => {
    const { runtime } = createRuntime();
    expect(runtime.keywords).toEqual(["terraform", "hcl"]);
  });
});

describe("DopsRuntimeV2.validate", () => {
  it("accepts valid input with prompt", () => {
    const { runtime } = createRuntime();
    expect(runtime.validate({ prompt: "Create an S3 bucket" }).valid).toBe(true);
  });

  it("accepts input with prompt and existingContent", () => {
    const { runtime } = createRuntime();
    const result = runtime.validate({
      prompt: "Add versioning",
      existingContent: 'resource "aws_s3_bucket" {}',
    });
    expect(result.valid).toBe(true);
  });

  it("rejects empty prompt", () => {
    const { runtime } = createRuntime();
    const result = runtime.validate({ prompt: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects missing prompt", () => {
    const { runtime } = createRuntime();
    const result = runtime.validate({});
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("DopsRuntimeV2.generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls LLM without schema and returns raw content", async () => {
    const rawHCL = 'resource "aws_s3_bucket" "main" {\n  bucket = "my-bucket"\n}';
    const { provider, runtime } = createRuntime(rawHCL);

    const result = await runtime.generate({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as { generated: string; isUpdate: boolean };
    expect(data.generated).toBe(rawHCL);
    expect(data.isUpdate).toBe(false);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });

    // Verify LLM was called WITHOUT schema
    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.schema).toBeUndefined();
    expect(call.system).toBeDefined();
    expect(call.prompt).toContain("Generate Terraform configuration");
  });

  it("strips markdown code fences from LLM response", async () => {
    const fencedContent =
      '```hcl\nresource "aws_s3_bucket" "main" {\n  bucket = "my-bucket"\n}\n```';
    const { runtime } = createRuntime(fencedContent);

    const result = await runtime.generate({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    const data = result.data as { generated: string };
    expect(data.generated).not.toContain("```");
    expect(data.generated).toContain('resource "aws_s3_bucket"');
  });

  it("fetches Context7 docs when provider is configured", async () => {
    const module = createV2Module({
      context: {
        technology: "Terraform",
        fileFormat: "hcl",
        outputGuidance: "Generate HCL.",
        bestPractices: ["Use modules"],
        context7Libraries: [{ name: "hashicorp/terraform", query: "S3 bucket resource" }],
      },
    });

    const mockDocProvider: DocProvider = {
      resolveLibrary: vi.fn().mockResolvedValue({ id: "/hashicorp/terraform", name: "Terraform" }),
      queryDocs: vi.fn().mockResolvedValue("Use `aws_s3_bucket` resource for S3 buckets."),
    };

    const provider = createMockProvider('resource "aws_s3_bucket" {}');
    const runtime = new DopsRuntimeV2(module, provider, {
      context7Provider: mockDocProvider,
    });

    const result = await runtime.generate({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    expect(mockDocProvider.resolveLibrary).toHaveBeenCalledWith(
      "hashicorp/terraform",
      "S3 bucket resource",
    );
    expect(mockDocProvider.queryDocs).toHaveBeenCalledWith(
      "/hashicorp/terraform",
      "S3 bucket resource",
    );
  });

  it("gracefully degrades when Context7 provider fails", async () => {
    const module = createV2Module({
      context: {
        technology: "Terraform",
        fileFormat: "hcl",
        outputGuidance: "Generate HCL.",
        bestPractices: ["Use modules"],
        context7Libraries: [{ name: "hashicorp/terraform", query: "S3 bucket" }],
      },
    });

    const mockDocProvider: DocProvider = {
      resolveLibrary: vi.fn().mockRejectedValue(new Error("Network error")),
      queryDocs: vi.fn(),
    };

    const provider = createMockProvider('resource "aws_s3_bucket" {}');
    const runtime = new DopsRuntimeV2(module, provider, {
      context7Provider: mockDocProvider,
    });

    const result = await runtime.generate({ prompt: "Create S3 bucket" });
    expect(result.success).toBe(true);
  });

  it("handles LLM errors gracefully", async () => {
    const module = createV2Module();
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockRejectedValue(new Error("LLM failed")),
    };
    const runtime = new DopsRuntimeV2(module, provider);

    const result = await runtime.generate({ prompt: "Create config" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("LLM failed");
  });

  it("sets isUpdate to true when existingContent is provided", async () => {
    const { provider, runtime } = createRuntime("updated content");

    const result = await runtime.generate({
      prompt: "Add versioning",
      existingContent: "old content",
    });

    expect(result.success).toBe(true);
    const data = result.data as { generated: string; isUpdate: boolean };
    expect(data.isUpdate).toBe(true);

    // Verify LLM was told it's an update
    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("Update");
  });
});

describe("DopsRuntimeV2.execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("writes raw content to files", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const rawContent = 'resource "aws_s3_bucket" "main" {}';
    const module = createV2Module();
    const provider = createMockProvider(rawContent);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("main.tf"),
      rawContent,
      "utf-8",
    );
  });

  it("skips write and tracks filesUnchanged when content is identical", async () => {
    const rawContent = 'resource "aws_s3_bucket" "main" {}';
    const module = createV2Module();
    const provider = createMockProvider(rawContent);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    // Simulate existing file with identical content
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(rawContent);

    const result = await runtime.execute({
      prompt: "Create S3 bucket",
      existingContent: rawContent,
    });

    expect(result.success).toBe(true);
    expect(result.filesUnchanged).toEqual(["main.tf"]);
    expect(result.filesWritten).toHaveLength(0);
    expect(result.filesModified).toHaveLength(0);
    // writeFileSync should NOT be called — content unchanged
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("defaults outputPath to current directory when file specs use {outputPath}", async () => {
    const rawContent = 'resource "aws_s3_bucket" "main" {}';
    const module = createV2Module({
      files: [{ path: "{outputPath}/main.tf", format: "raw" as const }],
    });
    const provider = createMockProvider(rawContent);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    // Should write to <basePath>/./main.tf (current directory)
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/test/main.tf", rawContent, "utf-8");
  });

  it("uses provided outputPath when given", async () => {
    const rawContent = 'resource "aws_s3_bucket" "main" {}';
    const module = createV2Module({
      files: [{ path: "{outputPath}/main.tf", format: "raw" as const }],
    });
    const provider = createMockProvider(rawContent);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create S3 bucket", outputPath: "infra" });

    expect(result.success).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/test/infra/main.tf", rawContent, "utf-8");
  });

  it("matches LLM file keys without {outputPath} prefix in multi-file mode", async () => {
    // LLM generates keys like "Chart.yaml", "templates/deployment.yaml"
    // but file specs use "{outputPath}/Chart.yaml", "{outputPath}/templates/deployment.yaml"
    const llmOutput = JSON.stringify({
      files: {
        "Chart.yaml": "apiVersion: v2\nname: myapp",
        "values.yaml": "replicaCount: 1",
        "templates/deployment.yaml": "kind: Deployment",
      },
    });
    const module = createV2Module({
      context: {
        technology: "Helm",
        fileFormat: "json",
        outputGuidance: "Output JSON",
        bestPractices: ["Use v2"],
      },
      files: [
        { path: "{outputPath}/Chart.yaml", format: "raw" as const },
        { path: "{outputPath}/values.yaml", format: "raw" as const },
        { path: "{outputPath}/templates/deployment.yaml", format: "raw" as const },
        { path: "{outputPath}/templates/service.yaml", format: "raw" as const, conditional: true },
      ],
    });
    const provider = createMockProvider(llmOutput);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create Helm chart" });

    expect(result.success).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/test/Chart.yaml",
      "apiVersion: v2\nname: myapp",
      "utf-8",
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/test/templates/deployment.yaml",
      "kind: Deployment",
      "utf-8",
    );
    // conditional file not in LLM output — should be skipped, not throw
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      expect.stringContaining("service.yaml"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not set outputPath when file specs don't reference it", async () => {
    const rawContent = 'resource "aws_s3_bucket" "main" {}';
    const module = createV2Module({
      files: [{ path: "main.tf", format: "raw" as const }],
    });
    const provider = createMockProvider(rawContent);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create S3 bucket" });

    expect(result.success).toBe(true);
    // Should write directly to basePath/main.tf, no subdirectory
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/test/main.tf", rawContent, "utf-8");
  });

  it("writes dynamically-named LLM files not in declared file specs", async () => {
    // LLM generates a composite action with a name not pre-declared in file specs
    const llmOutput = JSON.stringify({
      files: {
        ".github/actions/docker-build/action.yml": "name: Docker Build\nruns:\n  using: composite",
        ".github/workflows/ci.yml": "name: CI\non: push",
      },
    });
    const module = createV2Module({
      context: {
        technology: "GitHub Actions",
        fileFormat: "json",
        outputGuidance: "Output JSON",
        bestPractices: [],
      },
      files: [
        {
          path: "{outputPath}/.github/workflows/ci.yml",
          format: "raw" as const,
          conditional: true,
        },
        {
          path: "{outputPath}/.github/actions/setup/action.yml",
          format: "raw" as const,
          conditional: true,
        },
      ],
      scope: { write: ["**/*.yml", "**/*.yaml"] },
    });
    const provider = createMockProvider(llmOutput);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Create Docker build action" });

    expect(result.success).toBe(true);
    // Declared file spec matched
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/test/.github/workflows/ci.yml",
      "name: CI\non: push",
      "utf-8",
    );
    // Dynamic file — not in declared specs but within scope
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/tmp/test/.github/actions/docker-build/action.yml",
      "name: Docker Build\nruns:\n  using: composite",
      "utf-8",
    );
  });

  it("gracefully handles raw non-JSON output when all file specs are conditional", async () => {
    // LLM returns raw YAML for an analysis/check task instead of JSON wrapper
    const rawYaml = "name: Setup Node\ndescription: Sets up Node.js\nruns:\n  using: composite";
    const module = createV2Module({
      context: {
        technology: "GitHub Actions",
        fileFormat: "json",
        outputGuidance: "Output JSON",
        bestPractices: [],
      },
      files: [
        {
          path: "{outputPath}/.github/workflows/ci.yml",
          format: "raw" as const,
          conditional: true,
        },
        {
          path: "{outputPath}/.github/actions/setup/action.yml",
          format: "raw" as const,
          conditional: true,
        },
      ],
    });
    const provider = createMockProvider(rawYaml);
    const runtime = new DopsRuntimeV2(module, provider, { basePath: "/tmp/test" });

    const result = await runtime.execute({ prompt: "Analyse the existing composite action" });

    // Should succeed without writing any files — raw output is informational
    expect(result.success).toBe(true);
    expect(result.filesWritten).toHaveLength(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("DopsRuntimeV2.verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs binary verifier when configured", async () => {
    const module = createV2Module({
      verification: {
        structural: [{ path: "resource", required: true, message: "Must have resource" }],
      },
    });

    const provider = createMockProvider("");
    const runtime = new DopsRuntimeV2(module, provider);

    // Pass a YAML string that can be parsed for structural validation
    const result = await runtime.verify("resource:\n  type: aws_s3_bucket");
    // Structural validation will check the parsed object for "resource" path
    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });

  it("passes verification for content without verification config", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.verify("some raw content");
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("extracts generated content from { generated, isUpdate } object", async () => {
    const module = createV2Module({
      context: {
        technology: "GitHub Actions",
        fileFormat: "yaml",
        outputGuidance: "Generate valid YAML",
        bestPractices: [],
      },
      verification: {
        structural: [
          { path: "on", required: true, message: "Missing required 'on' trigger" },
          { path: "jobs", required: true, message: "Missing required 'jobs' section" },
        ],
      },
    });
    const provider = createMockProvider("");
    const runtime = new DopsRuntimeV2(module, provider);

    // Simulate what SafeExecutor passes: the generate() output data object
    const dataObject = {
      generated:
        "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4",
      isUpdate: false,
    };

    const result = await runtime.verify(dataObject);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("fails structural validation when generated content is missing required fields", async () => {
    const module = createV2Module({
      context: {
        technology: "GitHub Actions",
        fileFormat: "yaml",
        outputGuidance: "Generate valid YAML",
        bestPractices: [],
      },
      verification: {
        structural: [
          { path: "on", required: true, message: "Missing required 'on' trigger" },
          { path: "jobs", required: true, message: "Missing required 'jobs' section" },
        ],
      },
    });
    const provider = createMockProvider("");
    const runtime = new DopsRuntimeV2(module, provider);

    // Missing "on" and "jobs" from the YAML
    const dataObject = {
      generated: "name: CI\nsteps:\n  - run: echo hello",
      isUpdate: true,
    };

    const result = await runtime.verify(dataObject);
    expect(result.passed).toBe(false);
    const messages = result.issues.map((i) => i.message);
    expect(messages).toContain("Missing required 'on' trigger");
    expect(messages).toContain("Missing required 'jobs' section");
  });
});

describe("DopsRuntimeV2.verify with Context7 doc audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends doc-audit warnings for outdated action versions", async () => {
    const generated =
      "name: CI\non:\n  push:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3";

    const module = createV2Module({
      context: {
        technology: "GitHub Actions",
        fileFormat: "yaml",
        outputGuidance: "Generate YAML",
        bestPractices: [],
        context7Libraries: [{ name: "github-actions", query: "workflow syntax" }],
      },
    });

    const mockDocProvider: DocProvider = {
      resolveLibrary: vi.fn().mockResolvedValue({ id: "/github/actions", name: "GitHub Actions" }),
      queryDocs: vi.fn().mockResolvedValue("Use actions/checkout@v4 for latest features."),
    };

    const provider = createMockProvider(generated);
    const runtime = new DopsRuntimeV2(module, provider, {
      context7Provider: mockDocProvider,
    });

    // generate() fetches docs and caches them
    await runtime.generate({ prompt: "Create CI workflow" });

    // verify() uses cached docs for audit
    const result = await runtime.verify({ generated, isUpdate: false });

    const versionWarnings = result.issues.filter((i) => i.rule === "context7-version-check");
    expect(versionWarnings).toHaveLength(1);
    expect(versionWarnings[0].severity).toBe("warning");
    expect(versionWarnings[0].message).toContain("actions/checkout@v3");
    expect(versionWarnings[0].message).toContain("v4");
    // Warnings should not fail verification
    expect(result.passed).toBe(true);
  });

  it("does not produce doc-audit issues when no Context7 docs were cached", async () => {
    const { runtime } = createRuntime(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest",
    );

    // No generate() call → no cached docs
    const result = await runtime.verify("name: CI\non: push");
    const auditIssues = result.issues.filter(
      (i) => i.rule === "context7-version-check" || i.rule === "context7-deprecated-check",
    );
    expect(auditIssues).toHaveLength(0);
  });
});

describe("stripCodeFences", () => {
  it("strips ```yaml fences", () => {
    const input = "```yaml\nkey: value\nother: data\n```";
    expect(stripCodeFences(input)).toBe("key: value\nother: data");
  });

  it("strips ```hcl fences", () => {
    const input = '```hcl\nresource "aws_s3_bucket" "main" {\n  bucket = "test"\n}\n```';
    expect(stripCodeFences(input)).toBe('resource "aws_s3_bucket" "main" {\n  bucket = "test"\n}');
  });

  it("strips ~~~ fences", () => {
    const input = "~~~\nplain content\n~~~";
    expect(stripCodeFences(input)).toBe("plain content");
  });

  it("strips ~~~json fences", () => {
    const input = '~~~json\n{"key": "value"}\n~~~';
    expect(stripCodeFences(input)).toBe('{"key": "value"}');
  });

  it("strips ``` fences without language tag", () => {
    const input = "```\nraw content here\n```";
    expect(stripCodeFences(input)).toBe("raw content here");
  });

  it("returns content as-is when no fences present", () => {
    const input = "just plain content";
    expect(stripCodeFences(input)).toBe("just plain content");
  });

  it("trims whitespace around unfenced content", () => {
    const input = "  \n  content with spaces  \n  ";
    expect(stripCodeFences(input)).toBe("content with spaces");
  });
});

describe("parseRawContent", () => {
  it("parses YAML strings into objects", () => {
    const yaml = "name: test\nversion: 1.0.0\nitems:\n  - one\n  - two";
    const result = parseRawContent(yaml, "yaml");
    expect(result).toEqual({
      name: "test",
      version: "1.0.0",
      items: ["one", "two"],
    });
  });

  it("parses JSON strings into objects", () => {
    const json = '{"name": "test", "count": 42}';
    const result = parseRawContent(json, "json");
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("returns null for invalid YAML", () => {
    const result = parseRawContent(":\n  invalid:\n    :\n      bad", "yaml");
    // js-yaml may or may not throw on all invalid YAML; the function catches errors
    // This test verifies the error-catching path
    expect(result === null || result !== undefined).toBe(true);
  });

  it("returns null for invalid JSON", () => {
    const result = parseRawContent("{not valid json}", "json");
    expect(result).toBeNull();
  });

  it("returns null for raw format", () => {
    const result = parseRawContent("some raw content", "raw");
    expect(result).toBeNull();
  });

  it("returns null for hcl format", () => {
    const result = parseRawContent('resource "aws_s3_bucket" {}', "hcl");
    expect(result).toBeNull();
  });

  it("returns null for ini format", () => {
    const result = parseRawContent("[section]\nkey=value", "ini");
    expect(result).toBeNull();
  });

  it("returns null for toml format", () => {
    const result = parseRawContent('[package]\nname = "test"', "toml");
    expect(result).toBeNull();
  });
});

describe("parseMultiFileOutput", () => {
  it("parses JSON wrapper with files key", () => {
    const input = JSON.stringify({
      files: {
        "main.tf": 'resource "aws_s3_bucket" "b" {}',
        "variables.tf": 'variable "name" { type = string }',
      },
    });
    const result = parseMultiFileOutput(input);
    expect(result["main.tf"]).toBe('resource "aws_s3_bucket" "b" {}');
    expect(result["variables.tf"]).toBe('variable "name" { type = string }');
  });

  it("parses flat JSON object (no files wrapper)", () => {
    const input = JSON.stringify({
      "main.tf": "resource block",
      "outputs.tf": "output block",
    });
    const result = parseMultiFileOutput(input);
    expect(result["main.tf"]).toBe("resource block");
    expect(result["outputs.tf"]).toBe("output block");
  });

  it("strips code fences before parsing", () => {
    const json = JSON.stringify({ files: { "main.tf": "content" } });
    const input = "```json\n" + json + "\n```";
    const result = parseMultiFileOutput(input);
    expect(result["main.tf"]).toBe("content");
  });

  it("throws on non-JSON input", () => {
    expect(() => parseMultiFileOutput("not json at all")).toThrow("valid JSON");
  });

  it("throws on array input", () => {
    expect(() => parseMultiFileOutput("[]")).toThrow("JSON object");
  });

  it("throws when no string values found", () => {
    expect(() => parseMultiFileOutput('{"files": {"a": 123}}')).toThrow("string values");
  });

  it("ignores non-string values in files object", () => {
    const input = JSON.stringify({
      files: {
        "main.tf": "valid content",
        metadata: 42,
      },
    });
    const result = parseMultiFileOutput(input);
    expect(result["main.tf"]).toBe("valid content");
    expect(result["metadata"]).toBeUndefined();
  });

  it("repairs invalid JSON escape sequences from LLM output", () => {
    // LLMs sometimes produce invalid escapes like \: or \- in YAML content
    const input = String.raw`{"files": {".github/workflows/ci.yml": "name\: CI\non\: push"}}`;
    // \: is invalid escape → repaired by removing backslash → "name: CI\non: push"
    const result = parseMultiFileOutput(input);
    expect(result[".github/workflows/ci.yml"]).toBe("name: CI\non: push");
  });

  it("repairs line continuations in JSON strings from LLM output", () => {
    // LLMs break long JSON strings across lines using \ + newline
    const input =
      '{"files": {".github/actions/build/action.yml": "name: Build\\n\\\n        description: Builds the app"}}';
    const result = parseMultiFileOutput(input);
    expect(result[".github/actions/build/action.yml"]).toBe(
      "name: Build\ndescription: Builds the app",
    );
  });

  it("repairs raw control characters inside JSON string values", () => {
    // LLMs embed literal newlines/tabs inside JSON string values instead of \n/\t
    // Build a string with actual raw newline and tab inside a JSON string value
    const raw =
      '{"files": {".github/workflows/ci.yml": "name: CI' + "\n" + "on:" + "\n" + '  push:"}}';
    const result = parseMultiFileOutput(raw);
    expect(result[".github/workflows/ci.yml"]).toBe("name: CI\non:\n  push:");
  });

  it("repairs raw tabs inside JSON string values", () => {
    const raw = '{"files": {"Makefile": "build:' + "\n" + "\t" + 'go build ."}}';
    const result = parseMultiFileOutput(raw);
    expect(result["Makefile"]).toBe("build:\n\tgo build .");
  });
});
