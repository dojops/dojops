import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseDopsStringAny,
  parseDopsFileAny,
  validateDopsModuleV2,
  validateDopsModuleAny,
} from "../parser";
import { isV2Module, DopsModuleV2, DopsModule } from "../spec";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const MINIMAL_V1_DOPS = `---
dops: v1
kind: tool
meta:
  name: v1-tool
  version: 1.0.0
  description: "A v1 tool"
output:
  type: object
  properties:
    result:
      type: string
files:
  - path: "output.yaml"
    format: yaml
---
# V1 Tool

## Prompt

V1 prompt content.

## Keywords

v1, tool
`;

const MINIMAL_V2_DOPS = `---
dops: v2
kind: tool
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
kind: tool
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
kind: tool
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

describe("parseDopsStringAny", () => {
  it("parses v1 strings and returns v1 module", () => {
    const module = parseDopsStringAny(MINIMAL_V1_DOPS);
    expect(isV2Module(module)).toBe(false);
    expect(module.frontmatter.dops).toBe("v1");
    expect(module.frontmatter.meta.name).toBe("v1-tool");
    expect(module.sections.prompt).toContain("V1 prompt content");
    expect(module.sections.keywords).toContain("v1, tool");

    // v1-specific field
    const v1Module = module as DopsModule;
    expect(v1Module.frontmatter.output).toBeDefined();
  });

  it("parses v2 strings and returns v2 module", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS);
    expect(isV2Module(module)).toBe(true);
    expect(module.frontmatter.dops).toBe("v2");
    expect(module.frontmatter.meta.name).toBe("v2-tool");
    expect(module.sections.prompt).toContain("Generate Terraform configuration");
    expect(module.sections.keywords).toContain("terraform, hcl, iac");

    // v2-specific field
    const v2Module = module as DopsModuleV2;
    expect(v2Module.frontmatter.context).toBeDefined();
    expect(v2Module.frontmatter.context.technology).toBe("Terraform");
    expect(v2Module.frontmatter.context.fileFormat).toBe("hcl");
    expect(v2Module.frontmatter.context.bestPractices).toHaveLength(2);
  });

  it("parses full v2 module with all optional fields", () => {
    const module = parseDopsStringAny(FULL_V2_DOPS) as DopsModuleV2;
    expect(isV2Module(module)).toBe(true);
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
    const module = parseDopsStringAny(FULL_V2_DOPS_WITH_OLD_SECTIONS) as DopsModuleV2;
    expect(isV2Module(module)).toBe(true);
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
    expect(() => parseDopsStringAny(invalidV2)).toThrow("Invalid DOPS v2 frontmatter");
  });

  it("throws on invalid v1 frontmatter when version is v1", () => {
    const invalidV1 = `---
dops: v1
meta:
  name: bad-v1
  version: 1.0.0
  description: "Missing output"
files:
  - path: "out.yaml"
---
## Prompt

Test.

## Keywords

test
`;
    expect(() => parseDopsStringAny(invalidV1)).toThrow("Invalid DOPS frontmatter");
  });

  it("throws on missing frontmatter delimiter", () => {
    expect(() => parseDopsStringAny("no frontmatter")).toThrow(
      "DOPS file must start with --- frontmatter delimiter",
    );
  });

  it("throws on invalid YAML", () => {
    expect(() => parseDopsStringAny("---\n: invalid: yaml:\n---\n")).toThrow(
      "Invalid YAML in frontmatter",
    );
  });
});

describe("parseDopsFileAny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and parses a v2 file from disk", async () => {
    const fs = await import("node:fs");
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(MINIMAL_V2_DOPS);

    const module = parseDopsFileAny("/path/to/tool.dops");

    expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/tool.dops", "utf-8");
    expect(isV2Module(module)).toBe(true);
    expect(module.frontmatter.meta.name).toBe("v2-tool");
  });

  it("reads and parses a v1 file from disk", async () => {
    const fs = await import("node:fs");
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(MINIMAL_V1_DOPS);

    const module = parseDopsFileAny("/path/to/v1-tool.dops");

    expect(fs.readFileSync).toHaveBeenCalledWith("/path/to/v1-tool.dops", "utf-8");
    expect(isV2Module(module)).toBe(false);
    expect(module.frontmatter.meta.name).toBe("v1-tool");
  });
});

describe("validateDopsModuleV2", () => {
  it("returns valid for complete v2 module", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns valid for full v2 module", () => {
    const module = parseDopsStringAny(FULL_V2_DOPS) as DopsModuleV2;
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns errors for missing Prompt section", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.sections.prompt = "";
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Prompt section");
  });

  it("returns errors for missing Keywords section", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.sections.keywords = "";
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Keywords section");
  });

  it("returns errors for both missing Prompt and Keywords", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.sections.prompt = "";
    module.sections.keywords = "";
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain("Missing required ## Prompt section");
    expect(result.errors).toContain("Missing required ## Keywords section");
  });

  it("catches scope write path with path traversal", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.frontmatter.scope = { write: ["../etc/passwd"] };
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Scope write path contains path traversal: '../etc/passwd'");
  });

  it("catches unknown verification parser", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.frontmatter.verification = {
      binary: {
        command: "unknown-tool",
        parser: "unknown-parser",
        timeout: 30000,
        cwd: "output",
      },
    };
    const result = validateDopsModuleV2(module);
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain("Unknown verification parser");
  });
});

describe("validateDopsModuleAny", () => {
  it("dispatches v2 modules to validateDopsModuleV2", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    const result = validateDopsModuleAny(module);
    expect(result.valid).toBe(true);
  });

  it("dispatches v1 modules to validateDopsModule", () => {
    const module = parseDopsStringAny(MINIMAL_V1_DOPS) as DopsModule;
    const result = validateDopsModuleAny(module);
    expect(result.valid).toBe(true);
  });

  it("reports v2 validation errors via dispatch", () => {
    const module = parseDopsStringAny(MINIMAL_V2_DOPS) as DopsModuleV2;
    module.sections.prompt = "";
    const result = validateDopsModuleAny(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Prompt section");
  });

  it("reports v1 validation errors via dispatch", () => {
    const module = parseDopsStringAny(MINIMAL_V1_DOPS) as DopsModule;
    module.sections.keywords = "";
    const result = validateDopsModuleAny(module);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required ## Keywords section");
  });
});
