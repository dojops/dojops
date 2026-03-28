import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDopsString, parseDopsFile, validateDopsSkill } from "../parser";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 100 })),
}));

const MINIMAL_V2_DOPS = `---
dops: v2
kind: skill
meta:
  name: v2-tool
  version: 1.0.0
  description: "A v2 tool"
context:
  technology: Terraform
  fileFormat: hcl
  outputGuidance: |
    Generate valid HCL code.
  bestPractices:
    - Use modules for reusable components
    - Tag all resources
files:
  - path: "main.tf"
    format: raw
---
# V2 Tool

## Prompt

Generate Terraform configuration.

{outputGuidance}

## Keywords

terraform, hcl, iac
`;

const FULL_V2_DOPS = `---
dops: v2
kind: skill
meta:
  name: full-v2-tool
  version: 2.0.0
  description: "A full v2 tool"
  author: test-author
  tags:
    - terraform
    - iac
context:
  technology: Terraform
  fileFormat: hcl
  outputGuidance: |
    Generate valid Terraform HCL code with proper resource blocks.
  bestPractices:
    - Use modules for reusable components
    - Tag all resources with project and environment
    - Use variables for configurable values
  context7Libraries:
    - name: hashicorp/terraform
      query: "Resource block syntax"
files:
  - path: "main.tf"
    format: raw
  - path: "variables.tf"
    format: raw
    conditional: true
risk:
  level: MEDIUM
  rationale: "Modifies infrastructure"
execution:
  mode: generate
  deterministic: false
  idempotent: true
scope:
  write: ["*.tf"]
verification:
  binary:
    command: "terraform validate -json"
    parser: terraform-json
permissions:
  child_process: required
---
# Terraform Tool

## Prompt

You are a Terraform expert. {outputGuidance}

Best practices:
{bestPractices}

## Keywords

terraform, hcl, infrastructure, aws
`;

// Backward-compat fixture: a v2 file with the old sections still present
const FULL_V2_DOPS_WITH_OLD_SECTIONS = `---
dops: v2
kind: skill
meta:
  name: old-v2-tool
  version: 1.0.0
  description: "A v2 tool with old sections"
context:
  technology: Terraform
  fileFormat: hcl
  outputGuidance: |
    Generate valid HCL code.
  bestPractices:
    - Use modules
    - Tag resources
files:
  - path: "main.tf"
    format: raw
---
# Old V2 Tool

## Prompt

Generate Terraform config. {outputGuidance}

## Update Prompt

Update existing config: {existingContent}

## Constraints

- Use Terraform 1.5+ syntax

## Examples

Given: "S3 bucket"
Output: resource "aws_s3_bucket" { ... }

## Keywords

terraform, hcl
`;

describe("parseDopsString", () => {
  it("rejects v1 .dops files with clear error", () => {
    const v1Content = `---\ndops: v1\nname: test\n---\n# Prompt\nGenerate something\n\n## Keywords\n\ntest`;
    expect(() => parseDopsString(v1Content)).toThrow(/only v2 is supported/i);
  });

  it("rejects .dops files without a version field", () => {
    const noVersion = `---\nkind: skill\nmeta:\n  name: test\n---\n## Prompt\nTest\n\n## Keywords\n\ntest`;
    expect(() => parseDopsString(noVersion)).toThrow(/only v2 is supported/i);
  });

  it("parses v2 strings and returns module", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    expect(module.frontmatter.dops).toBe("v2");
    expect(module.frontmatter.meta.name).toBe("v2-tool");
    expect(module.sections.prompt).toContain("Generate Terraform configuration");
    expect(module.sections.keywords).toContain("terraform, hcl, iac");

    expect(module.frontmatter.context).toBeDefined();
    expect(module.frontmatter.context.technology).toBe("Terraform");
    expect(module.frontmatter.context.fileFormat).toBe("hcl");
    expect(module.frontmatter.context.bestPractices).toHaveLength(2);
  });

  it("parses full v2 module with all optional fields", () => {
    const module = parseDopsString(FULL_V2_DOPS);
    expect(module.frontmatter.meta.name).toBe("full-v2-tool");
    expect(module.frontmatter.meta.author).toBe("test-author");
    expect(module.frontmatter.context.context7Libraries).toHaveLength(1);
    expect(module.frontmatter.context.context7Libraries![0].name).toBe("hashicorp/terraform");
    expect(module.frontmatter.files).toHaveLength(2);
    expect(module.frontmatter.files[1].conditional).toBe(true);
    expect(module.frontmatter.risk!.level).toBe("MEDIUM");
    expect(module.frontmatter.execution!.idempotent).toBe(true);
    expect(module.frontmatter.scope!.write).toEqual(["*.tf"]);
    expect(module.frontmatter.verification!.binary!.parser).toBe("terraform-json");
    expect(module.sections.prompt).toContain("Terraform expert");
    expect(module.sections.keywords).toContain("terraform, hcl");
    expect(module.raw).toBe(FULL_V2_DOPS);
  });

  it("parses v2 file with old sections (backward compat)", () => {
    const module = parseDopsString(FULL_V2_DOPS_WITH_OLD_SECTIONS);
    expect(module.frontmatter.meta.name).toBe("old-v2-tool");
    // Parser still extracts old sections (needed for v1 compat), they're just ignored by compiler
    expect(module.sections.updatePrompt).toContain("Update existing config");
    expect(module.sections.constraints).toContain("Terraform 1.5+");
    expect(module.sections.examples).toContain("S3 bucket");
    expect(module.sections.prompt).toContain("Generate Terraform config");
    expect(module.sections.keywords).toContain("terraform, hcl");
  });

  it("throws on invalid v2 frontmatter", () => {
    const invalidV2 = `---
dops: v2
meta:
  name: bad-v2
  version: 1.0.0
  description: "Missing context"
files:
  - path: "out.yaml"
    format: raw
---
## Prompt

Test prompt.

## Keywords

test
`;
    expect(() => parseDopsString(invalidV2)).toThrow("Invalid DOPS v2 frontmatter");
  });

  it("throws on missing frontmatter delimiter", () => {
    expect(() => parseDopsString("no frontmatter")).toThrow(
      "DOPS file must start with --- frontmatter delimiter",
    );
  });

  it("throws on invalid YAML", () => {
    expect(() => parseDopsString("---\n: invalid: yaml:\n---\n")).toThrow(
      "Invalid YAML in frontmatter",
    );
  });
});

describe("parseDopsFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and parses a v2 file from disk", async () => {
    const fs = await import("node:fs");
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(MINIMAL_V2_DOPS);

    const module = parseDopsFile("/path/to/tool.dops");

    expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/tool.dops", "utf-8");
    expect(module.frontmatter.dops).toBe("v2");
    expect(module.frontmatter.meta.name).toBe("v2-tool");
  });

  it("rejects a v1 file from disk", async () => {
    const v1Content = `---
dops: v1
kind: skill
meta:
  name: v1-tool
  version: 1.0.0
  description: "A v1 tool"
output:
  type: object
files:
  - path: "output.yaml"
    format: yaml
---
## Prompt

V1 prompt.

## Keywords

v1
`;
    const fs = await import("node:fs");
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(v1Content);

    expect(() => parseDopsFile("/path/to/v1-tool.dops")).toThrow(/only v2 is supported/i);
  });
});

describe("validateDopsSkill", () => {
  it("returns valid for complete v2 module", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns valid for full v2 module", () => {
    const module = parseDopsString(FULL_V2_DOPS);
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns errors for missing Prompt section", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    module.sections.prompt = "";
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Prompt section");
  });

  it("returns errors for missing Keywords section", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    module.sections.keywords = "";
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Keywords section");
  });

  it("returns errors for both missing Prompt and Keywords", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    module.sections.prompt = "";
    module.sections.keywords = "";
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Missing required ## Prompt section");
    expect(result.errors).toContain("Missing required ## Keywords section");
  });

  it("catches scope write path with path traversal", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    module.frontmatter.scope = { write: ["../etc/passwd"] };
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scope write path contains path traversal: '../etc/passwd'");
  });

  it("catches unknown verification parser", () => {
    const module = parseDopsString(MINIMAL_V2_DOPS);
    module.frontmatter.verification = {
      binary: {
        command: "unknown-tool",
        parser: "unknown-parser",
        timeout: 30000,
        cwd: "output",
      },
    };
    const result = validateDopsSkill(module);
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("Unknown verification parser");
  });
});
