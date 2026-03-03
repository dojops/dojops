import { describe, it, expect, vi } from "vitest";
import type { RepoContext } from "@dojops/core";

// Mock all scanner modules
vi.mock("../scanners/npm", () => ({
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

vi.mock("../scanners/pip", () => ({
  scanPip: vi.fn().mockResolvedValue({
    tool: "pip-audit",
    findings: [],
    skipped: true,
    skipReason: "No Python dependency file found",
  }),
}));

vi.mock("../scanners/trivy", () => ({
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

vi.mock("../scanners/checkov", () => ({
  scanCheckov: vi.fn().mockResolvedValue({
    tool: "checkov",
    findings: [],
    skipped: true,
    skipReason: "checkov not found",
  }),
}));

vi.mock("../scanners/hadolint", () => ({
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

vi.mock("../scanners/gitleaks", () => ({
  scanGitleaks: vi.fn().mockResolvedValue({
    tool: "gitleaks",
    findings: [],
  }),
}));

vi.mock("../scanners/shellcheck", () => ({
  scanShellcheck: vi.fn().mockResolvedValue({
    tool: "shellcheck",
    findings: [],
    skipped: true,
    skipReason: "shellcheck not found",
  }),
}));

vi.mock("../scanners/trivy-sbom", () => ({
  scanTrivySbom: vi.fn().mockResolvedValue({
    tool: "trivy-sbom",
    findings: [],
    skipped: true,
    skipReason: "trivy not found",
  }),
}));

vi.mock("../scanners/trivy-license", () => ({
  scanTrivyLicense: vi.fn().mockResolvedValue({
    tool: "trivy-license",
    findings: [],
    skipped: true,
    skipReason: "trivy not found",
  }),
}));

vi.mock("../scan-policy", () => ({
  loadScanPolicy: vi.fn().mockReturnValue(undefined),
  evaluatePolicy: vi.fn(),
}));

import { runScan, deduplicateByCve, compareScanReports } from "../runner";

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
    // npm-audit and pip-audit are now in both "deps" and "security" categories (F2 fix)
    expect(report.scannersRun).toContain("npm-audit");
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

describe("T1: checkov applicable with CloudFormation only", () => {
  it("runs checkov when only hasCloudFormation is true", async () => {
    const ctx: RepoContext = {
      version: 2,
      scannedAt: new Date().toISOString(),
      rootPath: "/project",
      languages: [],
      primaryLanguage: null,
      packageManager: null,
      ci: [],
      container: { hasDockerfile: false, hasCompose: false },
      infra: {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
        hasKustomize: false,
        hasVagrant: false,
        hasPulumi: false,
        hasCloudFormation: true,
      },
      monitoring: {
        hasPrometheus: false,
        hasNginx: false,
        hasSystemd: false,
        hasHaproxy: false,
        hasTomcat: false,
        hasApache: false,
        hasCaddy: false,
        hasEnvoy: false,
      },
      scripts: { shellScripts: [], pythonScripts: [], hasJustfile: false },
      security: {
        hasEnvExample: false,
        hasGitignore: false,
        hasCodeowners: false,
        hasSecurityPolicy: false,
        hasDependabot: false,
        hasRenovate: false,
        hasSecretScanning: false,
        hasEditorConfig: false,
      },
      meta: {
        isGitRepo: true,
        isMonorepo: false,
        hasMakefile: false,
        hasReadme: false,
        hasEnvFile: false,
      },
      relevantDomains: [],
      devopsFiles: [],
    };

    const report = await runScan("/project", "iac", ctx);
    // checkov should have been selected (even though it's skipped due to binary not found)
    expect(
      report.scannersSkipped.some((s) => s.includes("checkov")) ||
        report.scannersRun.includes("checkov"),
    ).toBe(true);
  });
});

describe("T3: compareScanReports", () => {
  it("identifies new and resolved findings", () => {
    const current = {
      id: "scan-current",
      projectPath: "/project",
      timestamp: new Date().toISOString(),
      scanType: "all" as const,
      findings: [
        {
          id: "f1",
          tool: "trivy",
          severity: "HIGH" as const,
          category: "SECURITY",
          message: "Old vuln",
          autoFixAvailable: false,
        },
        {
          id: "f3",
          tool: "trivy",
          severity: "MEDIUM" as const,
          category: "SECURITY",
          message: "New vuln",
          autoFixAvailable: false,
        },
      ],
      summary: { total: 2, critical: 0, high: 1, medium: 1, low: 0 },
      scannersRun: ["trivy"],
      scannersSkipped: [],
      durationMs: 100,
    };

    const previous = {
      id: "scan-previous",
      projectPath: "/project",
      timestamp: new Date().toISOString(),
      scanType: "all" as const,
      findings: [
        {
          id: "f1",
          tool: "trivy",
          severity: "HIGH" as const,
          category: "SECURITY",
          message: "Old vuln",
          autoFixAvailable: false,
        },
        {
          id: "f2",
          tool: "trivy",
          severity: "LOW" as const,
          category: "SECURITY",
          message: "Resolved vuln",
          autoFixAvailable: false,
        },
      ],
      summary: { total: 2, critical: 0, high: 1, medium: 0, low: 1 },
      scannersRun: ["trivy"],
      scannersSkipped: [],
      durationMs: 80,
    };

    const result = compareScanReports(current, previous);
    expect(result.newFindings).toHaveLength(1);
    expect(result.newFindings[0].id).toBe("f3");
    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.resolvedFindings[0].id).toBe("f2");
  });
});

describe("T4: deduplicateByCve", () => {
  it("deduplicates findings with same CVE, keeping highest severity", () => {
    const findings = [
      {
        id: "f1",
        tool: "trivy",
        severity: "HIGH" as const,
        category: "SECURITY",
        message: "vuln",
        cve: "CVE-2024-0001",
        autoFixAvailable: false,
      },
      {
        id: "f2",
        tool: "npm-audit",
        severity: "CRITICAL" as const,
        category: "DEPENDENCY",
        message: "vuln",
        cve: "CVE-2024-0001",
        autoFixAvailable: false,
      },
      {
        id: "f3",
        tool: "trivy",
        severity: "MEDIUM" as const,
        category: "SECURITY",
        message: "other",
        autoFixAvailable: false,
      },
    ];

    const result = deduplicateByCve(findings);
    expect(result).toHaveLength(2);
    // f3 has no CVE, always kept
    expect(result.some((f) => f.id === "f3")).toBe(true);
    // CVE-2024-0001: f2 (CRITICAL) should be kept over f1 (HIGH)
    const cveResult = result.find((f) => f.cve === "CVE-2024-0001");
    expect(cveResult!.severity).toBe("CRITICAL");
  });

  it("keeps all findings without CVE", () => {
    const findings = [
      {
        id: "f1",
        tool: "hadolint",
        severity: "MEDIUM" as const,
        category: "IAC",
        message: "pin versions",
        autoFixAvailable: false,
      },
      {
        id: "f2",
        tool: "shellcheck",
        severity: "LOW" as const,
        category: "IAC",
        message: "quote var",
        autoFixAvailable: false,
      },
    ];

    const result = deduplicateByCve(findings);
    expect(result).toHaveLength(2);
  });
});

describe("scanner crash isolation (Promise.allSettled)", () => {
  it("isolates a crashing scanner and continues with others", async () => {
    // Make trivy crash with a rejected promise
    const { scanTrivy } = await import("../scanners/trivy");
    const mockedTrivy = vi.mocked(scanTrivy);
    mockedTrivy.mockRejectedValueOnce(new Error("trivy segfault: signal 11"));

    const report = await runScan("/project", "security");

    // Trivy should appear in scannersSkipped, NOT scannersRun
    expect(report.scannersRun).not.toContain("trivy");
    expect(report.scannersSkipped.some((s) => s.includes("trivy"))).toBe(true);
    expect(report.scannersSkipped.some((s) => s.includes("Scanner crashed"))).toBe(true);

    // The crash reason should be captured in the errors array
    expect(report.errors).toBeDefined();
    expect(report.errors!.some((e) => e.includes("trivy") && e.includes("crashed"))).toBe(true);
    expect(report.errors!.some((e) => e.includes("trivy segfault: signal 11"))).toBe(true);

    // Other scanners should still have run successfully
    expect(report.scannersRun).toContain("npm-audit");
    expect(report.scannersRun).toContain("gitleaks");

    // Findings from non-crashing scanners should still be present
    expect(report.findings.some((f) => f.tool === "npm-audit")).toBe(true);

    // Report should still be structurally valid
    expect(report.id).toMatch(/^scan-[a-f0-9]{8}$/);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.summary.total).toBeGreaterThan(0);
  });

  it("records crash reason from non-Error rejections", async () => {
    const { scanGitleaks } = await import("../scanners/gitleaks");
    const mockedGitleaks = vi.mocked(scanGitleaks);
    // Reject with a plain string (not an Error object)
    mockedGitleaks.mockRejectedValueOnce("binary not found");

    const report = await runScan("/project", "security");

    expect(report.scannersRun).not.toContain("gitleaks");
    expect(report.scannersSkipped.some((s) => s.includes("gitleaks"))).toBe(true);
    expect(report.errors).toBeDefined();
    expect(report.errors!.some((e) => e.includes("binary not found"))).toBe(true);

    // Other scanners still ran
    expect(report.scannersRun).toContain("trivy");
    expect(report.scannersRun).toContain("npm-audit");
  });

  it("handles multiple scanners crashing simultaneously", async () => {
    const { scanTrivy } = await import("../scanners/trivy");
    const { scanNpm } = await import("../scanners/npm");

    vi.mocked(scanTrivy).mockRejectedValueOnce(new Error("trivy OOM"));
    vi.mocked(scanNpm).mockRejectedValueOnce(new Error("npm registry timeout"));
    // gitleaks still works (default mock)

    const report = await runScan("/project", "security");

    // Both crashed scanners should be in skipped
    expect(report.scannersSkipped.some((s) => s.includes("trivy"))).toBe(true);
    expect(report.scannersSkipped.some((s) => s.includes("npm-audit"))).toBe(true);

    // Multiple errors should be recorded
    expect(report.errors).toBeDefined();
    expect(report.errors!.length).toBeGreaterThanOrEqual(2);

    // Gitleaks should still have run
    expect(report.scannersRun).toContain("gitleaks");

    // Report should still be valid even with multiple crashes
    expect(report.id).toMatch(/^scan-[a-f0-9]{8}$/);
    expect(report.timestamp).toBeTruthy();
  });

  it("produces valid summary even when all security scanners crash", async () => {
    const { scanTrivy } = await import("../scanners/trivy");
    const { scanNpm } = await import("../scanners/npm");
    const { scanGitleaks } = await import("../scanners/gitleaks");
    const { scanHadolint } = await import("../scanners/hadolint");
    const { scanCheckov } = await import("../scanners/checkov");

    vi.mocked(scanTrivy).mockRejectedValueOnce(new Error("crash"));
    vi.mocked(scanNpm).mockRejectedValueOnce(new Error("crash"));
    vi.mocked(scanGitleaks).mockRejectedValueOnce(new Error("crash"));
    vi.mocked(scanHadolint).mockRejectedValueOnce(new Error("crash"));
    vi.mocked(scanCheckov).mockRejectedValueOnce(new Error("crash"));

    const report = await runScan("/project", "security");

    // All should be skipped, none should have run
    expect(report.scannersRun).toHaveLength(0);
    expect(report.scannersSkipped.length).toBeGreaterThan(0);

    // Summary should be zero across the board
    expect(report.summary.total).toBe(0);
    expect(report.summary.critical).toBe(0);
    expect(report.summary.high).toBe(0);
    expect(report.summary.medium).toBe(0);
    expect(report.summary.low).toBe(0);

    // Findings should be empty
    expect(report.findings).toHaveLength(0);

    // Errors should be populated
    expect(report.errors).toBeDefined();
    expect(report.errors!.length).toBeGreaterThan(0);
  });
});
