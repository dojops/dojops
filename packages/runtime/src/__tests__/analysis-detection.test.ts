import { describe, it, expect } from "vitest";
import { isAnalysisText, validateGeneratedContent } from "../runtime";

describe("isAnalysisText", () => {
  it("detects markdown heading level 2", () => {
    expect(isAnalysisText("## Analysis of Docker Compose\n\nThe config...")).toBe(true);
  });

  it("detects markdown heading level 3", () => {
    expect(isAnalysisText("### Current Structure and Services\n\n**Services:**")).toBe(true);
  });

  it("detects markdown bold at start", () => {
    expect(isAnalysisText("**Summary:** The docker-compose.yml has 3 services")).toBe(true);
  });

  it("ignores leading whitespace before markdown heading", () => {
    expect(isAnalysisText("  ## Analysis\n\nFindings...")).toBe(true);
  });

  it("does not match valid YAML (starts with key:)", () => {
    expect(isAnalysisText("services:\n  web:\n    image: nginx")).toBe(false);
  });

  it("does not match valid YAML with single-hash comment", () => {
    expect(isAnalysisText("# Docker Compose config\nservices:\n  web:\n    image: nginx")).toBe(
      false,
    );
  });

  it("does not match valid JSON", () => {
    expect(isAnalysisText('{"services": {"web": {}}}')).toBe(false);
  });

  it("does not match valid HCL/Terraform", () => {
    expect(isAnalysisText('resource "aws_s3_bucket" "main" {\n  bucket = "test"\n}')).toBe(false);
  });

  it("does not match empty string", () => {
    expect(isAnalysisText("")).toBe(false);
  });

  it("does not match single hash without space (YAML comment prefix)", () => {
    expect(isAnalysisText("#comment without space")).toBe(false);
  });

  it("detects real-world analysis output that caused the bug", () => {
    const bugOutput = `## Analysis of Existing Docker Compose Config

### 1. Current Structure and Services
**Services:**
- **app**: Node.js/Next.js application service
  - Builds from local Dockerfile`;
    expect(isAnalysisText(bugOutput)).toBe(true);
  });
});

describe("validateGeneratedContent", () => {
  it("accepts valid YAML", () => {
    expect(validateGeneratedContent("services:\n  web:\n    image: nginx", "yaml", "test")).toEqual(
      [],
    );
  });

  it("rejects invalid YAML", () => {
    const errors = validateGeneratedContent("key: [invalid", "yaml", "test");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid YAML");
  });

  it("accepts valid JSON", () => {
    expect(validateGeneratedContent('{"key": "value"}', "json", "test")).toEqual([]);
  });

  it("rejects invalid JSON", () => {
    const errors = validateGeneratedContent("{invalid json", "json", "test");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("Invalid JSON");
  });

  it("accepts any content for raw format", () => {
    expect(validateGeneratedContent("anything goes here", "raw", "test")).toEqual([]);
  });

  it("rejects empty content", () => {
    const errors = validateGeneratedContent("", "yaml", "test");
    expect(errors).toEqual(["Empty content for test"]);
  });
});
