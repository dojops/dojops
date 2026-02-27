import { describe, it, expect } from "vitest";
import { compilePrompt } from "../prompt-compiler";
import { MarkdownSections } from "../spec";

describe("compilePrompt", () => {
  const baseSections: MarkdownSections = {
    prompt: "You are a Terraform expert.",
    keywords: "terraform, iac",
  };

  it("compiles a basic prompt", () => {
    const result = compilePrompt(baseSections, {});
    expect(result).toBe("You are a Terraform expert.");
  });

  it("appends constraints as numbered list", () => {
    const sections: MarkdownSections = {
      ...baseSections,
      constraints: "- Rule 1\n- Rule 2\n- Rule 3",
    };
    const result = compilePrompt(sections, {});
    expect(result).toContain("CONSTRAINTS:");
    expect(result).toContain("1. Rule 1");
    expect(result).toContain("2. Rule 2");
    expect(result).toContain("3. Rule 3");
  });

  it("appends examples section", () => {
    const sections: MarkdownSections = {
      ...baseSections,
      examples: 'Given: "S3 bucket"\n```json\n{"resources": []}\n```',
    };
    const result = compilePrompt(sections, {});
    expect(result).toContain("EXAMPLES:");
    expect(result).toContain("S3 bucket");
  });

  it("uses update prompt when existingContent is present", () => {
    const sections: MarkdownSections = {
      ...baseSections,
      updatePrompt: "Update existing config.\n{existingContent}",
    };
    const result = compilePrompt(sections, { existingContent: "old content" });
    expect(result).toContain("Update existing config.");
    expect(result).toContain("old content");
    expect(result).not.toContain("You are a Terraform expert.");
  });

  it("falls back to prompt + generic update suffix when no update prompt", () => {
    const result = compilePrompt(baseSections, { existingContent: "existing" });
    expect(result).toContain("You are a Terraform expert.");
    expect(result).toContain("UPDATING an existing configuration");
    expect(result).toContain("existing");
  });

  it("substitutes input variables", () => {
    const sections: MarkdownSections = {
      prompt: "Use the {provider} provider in {region}.",
      keywords: "test",
    };
    const result = compilePrompt(sections, {
      input: { provider: "aws", region: "us-east-1" },
    });
    expect(result).toContain("Use the aws provider in us-east-1.");
  });

  it("handles constraints with various bullet styles", () => {
    const sections: MarkdownSections = {
      ...baseSections,
      constraints: "* Star bullet\n- Dash bullet\nPlain line",
    };
    const result = compilePrompt(sections, {});
    expect(result).toContain("1. Star bullet");
    expect(result).toContain("2. Dash bullet");
    expect(result).toContain("3. Plain line");
  });
});
