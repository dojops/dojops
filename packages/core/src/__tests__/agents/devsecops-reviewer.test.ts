import { describe, it, expect, vi } from "vitest";
import { DevSecOpsReviewer, ReviewReportSchema } from "../../agents/devsecops-reviewer";
import type { LLMProvider, LLMResponse } from "../../llm/provider";

function mockProvider(response: Partial<LLMResponse> = {}): LLMProvider {
  const defaultReport = {
    summary: "Review found 2 issues in CI workflow.",
    score: 72,
    findings: [
      {
        file: ".github/workflows/ci.yml",
        severity: "high",
        category: "version",
        message: "actions/checkout@v3 is outdated",
        recommendation: "Upgrade to actions/checkout@v4",
        line: 12,
        toolSource: null,
      },
      {
        file: ".github/workflows/ci.yml",
        severity: "medium",
        category: "syntax",
        message: "Missing 'shell' in composite action run step",
        recommendation: "Add 'shell: bash' to the run step",
        line: 25,
        toolSource: "actionlint",
      },
    ],
    recommendedActions: [
      "Upgrade actions/checkout from v3 to v4",
      "Add explicit shell to composite action steps",
    ],
  };

  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(response.parsed ?? defaultReport),
      parsed: response.parsed ?? defaultReport,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      ...response,
    }),
  };
}

describe("DevSecOpsReviewer", () => {
  it("produces a structured ReviewReport", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    const report = await reviewer.review({
      files: [{ path: ".github/workflows/ci.yml", content: "name: CI\non: push" }],
      toolResults: [],
    });

    expect(report.summary).toBeDefined();
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.findings).toHaveLength(2);
    expect(report.recommendedActions).toHaveLength(2);
  });

  it("includes file contents in the prompt", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [{ path: "Dockerfile", content: "FROM node:20\nRUN npm ci" }],
      toolResults: [],
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("Dockerfile");
    expect(call.prompt).toContain("FROM node:20");
  });

  it("includes tool validation results in the prompt", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [{ path: ".github/workflows/ci.yml", content: "name: CI" }],
      toolResults: [
        {
          tool: "actionlint",
          file: ".github/workflows/ci.yml",
          passed: false,
          issues: [
            {
              severity: "error",
              message: "workflow is empty",
              line: 1,
              rule: "syntax-check",
            },
          ],
          rawOutput: "Error: workflow is empty",
        },
      ],
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("actionlint");
    expect(call.prompt).toContain("FAILED");
    expect(call.prompt).toContain("workflow is empty");
    expect(call.prompt).toContain("line 1");
  });

  it("includes Context7 docs in the prompt", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [{ path: "ci.yml", content: "on: push" }],
      toolResults: [],
      context7Docs: "actions/checkout@v4 is the latest version.",
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("Reference Documentation");
    expect(call.prompt).toContain("actions/checkout@v4");
  });

  it("sends schema for structured output", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [{ path: "test.yml", content: "key: value" }],
      toolResults: [],
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.schema).toBe(ReviewReportSchema);
  });

  it("handles provider returning parsed response", async () => {
    const parsedReport = {
      summary: "Clean config.",
      score: 95,
      findings: [],
      recommendedActions: [],
    };

    const provider = mockProvider({ parsed: parsedReport });
    const reviewer = new DevSecOpsReviewer(provider);

    const report = await reviewer.review({
      files: [{ path: "ok.yml", content: "clean: true" }],
      toolResults: [],
    });

    expect(report.score).toBe(95);
    expect(report.findings).toHaveLength(0);
  });

  it("shows PASSED status for tools that pass", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [{ path: "script.sh", content: "#!/bin/bash\necho ok" }],
      toolResults: [
        {
          tool: "shellcheck",
          file: "script.sh",
          passed: true,
          issues: [],
        },
      ],
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("shellcheck");
    expect(call.prompt).toContain("PASSED");
    expect(call.prompt).toContain("No issues found");
  });

  it("handles multiple files and tool results", async () => {
    const provider = mockProvider();
    const reviewer = new DevSecOpsReviewer(provider);

    await reviewer.review({
      files: [
        { path: "Dockerfile", content: "FROM node:20" },
        { path: ".github/workflows/ci.yml", content: "name: CI" },
        { path: "main.tf", content: 'resource "aws_s3_bucket" {}' },
      ],
      toolResults: [
        { tool: "hadolint", file: "Dockerfile", passed: true, issues: [] },
        {
          tool: "actionlint",
          file: ".github/workflows/ci.yml",
          passed: false,
          issues: [{ severity: "error", message: "missing jobs" }],
        },
        { tool: "terraform", file: "main.tf", passed: true, issues: [] },
      ],
    });

    const call = vi.mocked(provider.generate).mock.calls[0][0];
    expect(call.prompt).toContain("Dockerfile");
    expect(call.prompt).toContain("ci.yml");
    expect(call.prompt).toContain("main.tf");
    expect(call.prompt).toContain("hadolint");
    expect(call.prompt).toContain("actionlint");
    expect(call.prompt).toContain("terraform");
  });
});
