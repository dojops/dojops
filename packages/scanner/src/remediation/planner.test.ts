import { describe, it, expect, vi } from "vitest";
import type { LLMProvider } from "@dojops/core";
import { planRemediation } from "./planner";
import type { ScanFinding } from "../types";

function createMockProvider(response: { content: string; parsed?: unknown }): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue(response),
  };
}

describe("planRemediation", () => {
  it("returns empty fixes when no HIGH/CRITICAL findings", async () => {
    const provider = createMockProvider({ content: "" });
    const findings: ScanFinding[] = [
      {
        id: "f1",
        tool: "npm-audit",
        severity: "LOW",
        category: "DEPENDENCY",
        message: "low sev",
        autoFixAvailable: false,
      },
      {
        id: "f2",
        tool: "hadolint",
        severity: "MEDIUM",
        category: "SECURITY",
        message: "medium sev",
        autoFixAvailable: false,
      },
    ];

    const plan = await planRemediation(findings, provider);
    expect(plan.fixes).toHaveLength(0);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("calls LLM with HIGH/CRITICAL findings and returns fixes", async () => {
    const mockFixes = {
      fixes: [
        {
          findingId: "f1",
          action: "update-version",
          file: "package.json",
          patch: "lodash@4.17.21",
          description: "Update lodash to fix prototype pollution",
        },
      ],
    };
    const provider = createMockProvider({
      content: JSON.stringify(mockFixes),
      parsed: mockFixes,
    });

    const findings: ScanFinding[] = [
      {
        id: "f1",
        tool: "npm-audit",
        severity: "HIGH",
        category: "DEPENDENCY",
        message: "lodash: prototype pollution",
        recommendation: "Update to lodash@4.17.21",
        autoFixAvailable: true,
      },
      {
        id: "f2",
        tool: "trivy",
        severity: "CRITICAL",
        category: "SECURITY",
        message: "CVE-2024-0001",
        autoFixAvailable: false,
      },
    ];

    const plan = await planRemediation(findings, provider);
    expect(plan.fixes).toHaveLength(1);
    expect(plan.fixes[0].findingId).toBe("f1");
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it("falls back to content parsing when parsed is undefined", async () => {
    const mockFixes = {
      fixes: [
        {
          findingId: "f1",
          action: "replace",
          file: "Dockerfile",
          patch: "FROM node:18>>>FROM node:18-slim",
          description: "Use slim image",
        },
      ],
    };
    const provider = createMockProvider({
      content: JSON.stringify(mockFixes),
      parsed: undefined,
    });

    const findings: ScanFinding[] = [
      {
        id: "f1",
        tool: "hadolint",
        severity: "HIGH",
        category: "SECURITY",
        message: "DL3007: Use specific tag",
        autoFixAvailable: false,
      },
    ];

    const plan = await planRemediation(findings, provider);
    expect(plan.fixes).toHaveLength(1);
  });

  it("returns empty fixes when LLM output is invalid", async () => {
    const provider = createMockProvider({
      content: "I cannot generate a valid fix for this",
      parsed: undefined,
    });

    const findings: ScanFinding[] = [
      {
        id: "f1",
        tool: "trivy",
        severity: "CRITICAL",
        category: "SECURITY",
        message: "CVE",
        autoFixAvailable: false,
      },
    ];

    const plan = await planRemediation(findings, provider);
    expect(plan.fixes).toHaveLength(0);
  });
});
