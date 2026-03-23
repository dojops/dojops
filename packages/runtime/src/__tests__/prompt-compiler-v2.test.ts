import { describe, it, expect } from "vitest";
import { compilePromptV2, PromptContextV2 } from "../prompt-compiler";
import { ContextBlock, MarkdownSections } from "../spec";

const baseContext: ContextBlock = {
  technology: "Terraform",
  fileFormat: "hcl",
  outputGuidance: "Generate valid HCL code with proper resource blocks.",
  bestPractices: [
    "Use modules for reusable components",
    "Tag all resources with project and environment",
    "Use variables for configurable values",
  ],
};

const baseSections: MarkdownSections = {
  prompt:
    "You are a Terraform expert.\n\nGuidance: {outputGuidance}\n\nBest practices:\n{bestPractices}",
  keywords: "terraform, hcl",
};

function makeContext(overrides?: Partial<PromptContextV2>): PromptContextV2 {
  return {
    contextBlock: baseContext,
    ...overrides,
  };
}

describe("compilePromptV2", () => {
  it("substitutes {outputGuidance} from context block", () => {
    const result = compilePromptV2(baseSections, makeContext());
    expect(result).toContain("Generate valid HCL code with proper resource blocks.");
    expect(result).not.toContain("{outputGuidance}");
  });

  it("substitutes {bestPractices} as numbered list", () => {
    const result = compilePromptV2(baseSections, makeContext());
    expect(result).toContain("1. Use modules for reusable components");
    expect(result).toContain("2. Tag all resources with project and environment");
    expect(result).toContain("3. Use variables for configurable values");
    expect(result).not.toContain("{bestPractices}");
  });

  it("substitutes {context7Docs} when provided and wraps as data", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config.\n\nReference docs:\n{context7Docs}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({ context7Docs: "### Terraform\nUse `resource` blocks." }),
    );
    expect(result).toContain("### Terraform");
    expect(result).toContain("Use `resource` blocks.");
    expect(result).toContain('<data label="reference-docs">');
    expect(result).not.toContain("{context7Docs}");
  });

  it("replaces {context7Docs} with fallback when not provided", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config.\n\nDocs: {context7Docs}",
      keywords: "test",
    };
    const result = compilePromptV2(sections, makeContext());
    expect(result).toContain("No additional documentation available.");
    expect(result).not.toContain("{context7Docs}");
  });

  it("substitutes {projectContext} when provided and wraps as data", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config.\n\nProject info:\n{projectContext}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({ projectContext: "Node.js 20, Express, PostgreSQL" }),
    );
    expect(result).toContain("Node.js 20, Express, PostgreSQL");
    expect(result).toContain('<data label="project-context">');
    expect(result).not.toContain("{projectContext}");
  });

  it("replaces {projectContext} with fallback when not provided", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config.\n\nContext: {projectContext}",
      keywords: "test",
    };
    const result = compilePromptV2(sections, makeContext());
    expect(result).toContain("No project context available.");
    expect(result).not.toContain("{projectContext}");
  });

  it("always uses generic update fallback (ignores updatePrompt)", () => {
    const sections: MarkdownSections = {
      prompt: "Generate new Terraform config. {outputGuidance}",
      updatePrompt: "Update existing config. Current: {existingContent}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({ existingContent: 'resource "aws_s3_bucket" {}' }),
    );
    // Should use the generic fallback, not the updatePrompt
    expect(result).toContain("Generate new Terraform config.");
    expect(result).toContain("UPDATING an existing configuration");
    expect(result).toContain('resource "aws_s3_bucket" {}');
    expect(result).toContain('<data label="existing-config">');
    // Should NOT use the dedicated update prompt
    expect(result).not.toContain("Update existing config. Current:");
  });

  it("falls back to prompt + generic update suffix when no update prompt", () => {
    const sections: MarkdownSections = {
      prompt: "You are a Terraform expert. {outputGuidance}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({ existingContent: "old config content" }),
    );
    expect(result).toContain("You are a Terraform expert.");
    expect(result).toContain("UPDATING an existing configuration");
    expect(result).toContain("old config content");
    expect(result).toContain('<data label="existing-config">');
  });

  it("handles missing optional variables gracefully", () => {
    const sections: MarkdownSections = {
      prompt:
        "Generate config.\n\nGuidance: {outputGuidance}\nPractices: {bestPractices}\nDocs: {context7Docs}\nProject: {projectContext}",
      keywords: "test",
    };
    // No context7Docs or projectContext
    const result = compilePromptV2(sections, makeContext());
    expect(result).toContain("Generate valid HCL code");
    expect(result).toContain("1. Use modules");
    expect(result).toContain("No additional documentation available.");
    expect(result).toContain("No project context available.");
    // No leftover placeholders
    expect(result).not.toContain("{outputGuidance}");
    expect(result).not.toContain("{bestPractices}");
    expect(result).not.toContain("{context7Docs}");
    expect(result).not.toContain("{projectContext}");
  });

  it("ignores constraints section when present", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config. {outputGuidance}",
      constraints: "- Use Terraform 1.5+ syntax\n- Include required providers block",
      keywords: "test",
    };
    const result = compilePromptV2(sections, makeContext());
    expect(result).not.toContain("CONSTRAINTS:");
    expect(result).not.toContain("Use Terraform 1.5+ syntax");
    expect(result).not.toContain("Include required providers block");
  });

  it("ignores examples section when present", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config. {outputGuidance}",
      examples: 'Given: "S3 bucket"\nOutput: resource "aws_s3_bucket" { ... }',
      keywords: "test",
    };
    const result = compilePromptV2(sections, makeContext());
    expect(result).not.toContain("EXAMPLES:");
    expect(result).not.toContain("S3 bucket");
  });

  it("ignores all three removed sections when present together", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config. {outputGuidance}",
      updatePrompt: "Update existing: {existingContent}",
      constraints: "- Must use v1.5+ syntax",
      examples: "Example: some output here",
      keywords: "test",
    };
    const result = compilePromptV2(sections, makeContext({ existingContent: "old content" }));
    // Should use generic fallback, not updatePrompt
    expect(result).toContain("UPDATING an existing configuration");
    expect(result).not.toContain("Update existing:");
    // Should not include constraints or examples
    expect(result).not.toContain("CONSTRAINTS:");
    expect(result).not.toContain("Must use v1.5+ syntax");
    expect(result).not.toContain("EXAMPLES:");
    expect(result).not.toContain("Example: some output here");
  });

  it("wraps {existingContent} substitution with data boundary", () => {
    const sections: MarkdownSections = {
      prompt: "Config: {existingContent}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({ existingContent: "server { listen 80; }" }),
    );
    expect(result).toContain('<data label="existing-config">');
    expect(result).toContain("server { listen 80; }");
    expect(result).toContain("</data>");
    expect(result).not.toContain("{existingContent}");
  });

  it("adds preserve_structure instruction in update mode", () => {
    const sections: MarkdownSections = {
      prompt: "Generate config. {outputGuidance}",
      keywords: "test",
    };
    const result = compilePromptV2(
      sections,
      makeContext({
        existingContent: "old content",
        updateConfig: {
          strategy: "preserve_structure",
          inputSource: "file",
          injectAs: "existingContent",
        },
      }),
    );
    expect(result).toContain("Preserve the overall structure");
  });
});
