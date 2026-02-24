import { describe, it, expect, vi } from "vitest";
import type { RepoContext } from "@dojops/core";

// Mock all scanner modules
vi.mock("./scanners/npm", () => ({
  scanNpm: vi.fn().mockResolvedValue({
    tool: "npm-audit",
    findings: [
      {
        id: "npm-001",
        tool: "npm-audit",
        severity: "HIGH",
        category: "DEPENDENCY",
        message: "lodash: prototype pollution",
        autoFixAvailable: true,
      },
    ],
  }),
}));

vi.mock("./scanners/pip", () => ({
  scanPip: vi.fn().mockResolvedValue({
    tool: "pip-audit",
    findings: [],
    skipped: true,
    skipReason: "No Python dependency file found",
  }),
}));

vi.mock("./scanners/trivy", () => ({
  scanTrivy: vi.fn().mockResolvedValue({
    tool: "trivy",
    findings: [
      {
        id: "trivy-001",
        tool: "trivy",
        severity: "CRITICAL",
        category: "SECURITY",
        message: "CVE-2024-0001",
        autoFixAvailable: false,
      },
    ],
  }),
}));

vi.mock("./scanners/checkov", () => ({
  scanCheckov: vi.fn().mockResolvedValue({
    tool: "checkov",
    findings: [],
    skipped: true,
    skipReason: "checkov not found",
  }),
}));

vi.mock("./scanners/hadolint", () => ({
  scanHadolint: vi.fn().mockResolvedValue({
    tool: "hadolint",
    findings: [
      {
        id: "hadolint-001",
        tool: "hadolint",
        severity: "MEDIUM",
        category: "SECURITY",
        message: "DL3008: Pin versions",
        autoFixAvailable: false,
      },
    ],
  }),
}));

vi.mock("./scanners/gitleaks", () => ({
  scanGitleaks: vi.fn().mockResolvedValue({
    tool: "gitleaks",
    findings: [],
  }),
}));

import { runScan } from "./runner";

describe("runScan", () => {
  it("generates a scan report with unique ID", async () => {
    const report = await runScan("/project", "all");
    expect(report.id).toMatch(/^scan-[a-f0-9]{8}$/);
    expect(report.projectPath).toBe("/project");
    expect(report.scanType).toBe("all");
    expect(report.timestamp).toBeTruthy();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("aggregates findings from all scanners", async () => {
    const report = await runScan("/project", "all");
    // npm-audit: 1, trivy: 1, hadolint: 1 = 3 total
    expect(report.findings.length).toBe(3);
  });

  it("computes summary correctly", async () => {
    const report = await runScan("/project", "all");
    expect(report.summary.total).toBe(3);
    expect(report.summary.critical).toBe(1);
    expect(report.summary.high).toBe(1);
    expect(report.summary.medium).toBe(1);
    expect(report.summary.low).toBe(0);
  });

  it("tracks run vs skipped scanners", async () => {
    const report = await runScan("/project", "all");
    expect(report.scannersRun).toContain("npm-audit");
    expect(report.scannersRun).toContain("trivy");
    expect(report.scannersRun).toContain("gitleaks");
    expect(report.scannersRun).toContain("hadolint");
    expect(report.scannersSkipped.length).toBeGreaterThan(0);
    expect(report.scannersSkipped.some((s) => s.includes("pip-audit"))).toBe(true);
    expect(report.scannersSkipped.some((s) => s.includes("checkov"))).toBe(true);
  });

  it("filters scanners by type: deps", async () => {
    const report = await runScan("/project", "deps");
    // Only npm-audit and pip-audit run for deps
    // npm returns findings, pip is skipped
    expect(report.scannersRun).toContain("npm-audit");
    expect(report.scannersRun).not.toContain("trivy");
    expect(report.scannersRun).not.toContain("gitleaks");
  });

  it("filters scanners by type: security", async () => {
    const report = await runScan("/project", "security");
    expect(report.scannersRun).toContain("trivy");
    expect(report.scannersRun).toContain("gitleaks");
    expect(report.scannersRun).not.toContain("npm-audit");
  });

  it("uses repo context for scanner selection", async () => {
    const ctx: RepoContext = {
      version: 1,
      scannedAt: new Date().toISOString(),
      rootPath: "/project",
      languages: [{ name: "Python", confidence: 0.9, indicator: "requirements.txt" }],
      primaryLanguage: "Python",
      packageManager: { name: "pip" },
      ci: [],
      container: { hasDockerfile: false, hasCompose: false },
      infra: {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      monitoring: { hasPrometheus: false, hasNginx: false, hasSystemd: false },
      meta: {
        isGitRepo: true,
        isMonorepo: false,
        hasMakefile: false,
        hasReadme: true,
        hasEnvFile: false,
      },
      relevantDomains: [],
    };

    const report = await runScan("/project", "all", ctx);
    // Python project → npm-audit not applicable, hadolint not applicable
    expect(report.scannersRun).not.toContain("npm-audit");
    expect(report.scannersRun).not.toContain("hadolint");
  });

  it("enables npm-audit in monorepo when languages include node", async () => {
    const ctx: RepoContext = {
      version: 1,
      scannedAt: new Date().toISOString(),
      rootPath: "/project",
      languages: [
        { name: "python", confidence: 0.9, indicator: "requirements.txt" },
        { name: "node", confidence: 0.81, indicator: "backend/package.json" },
      ],
      primaryLanguage: "python",
      packageManager: { name: "pip" },
      ci: [],
      container: { hasDockerfile: false, hasCompose: false },
      infra: {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      monitoring: { hasPrometheus: false, hasNginx: false, hasSystemd: false },
      meta: {
        isGitRepo: true,
        isMonorepo: true,
        hasMakefile: false,
        hasReadme: true,
        hasEnvFile: false,
      },
      relevantDomains: [],
    };

    const report = await runScan("/project", "all", ctx);
    // Monorepo with both Python and Node → both npm-audit and pip-audit should run
    expect(report.scannersRun).toContain("npm-audit");
    expect(report.scannersSkipped.some((s) => s.includes("pip-audit"))).toBe(true);
  });
});
