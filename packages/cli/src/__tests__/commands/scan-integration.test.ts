import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
  confirm: vi.fn().mockResolvedValue(false),
}));

const cleanReport = {
  id: "scan-001",
  projectPath: "/tmp/test-project",
  timestamp: "2026-04-25T10:00:00Z",
  scanType: "security" as const,
  findings: [],
  summary: {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
  scannersRun: ["gitleaks", "npm-audit"],
  scannersSkipped: [],
  durationMs: 320,
};

const findingsReport = {
  id: "scan-002",
  projectPath: "/tmp/test-project",
  timestamp: "2026-04-25T10:00:00Z",
  scanType: "security" as const,
  findings: [
    {
      scanner: "gitleaks",
      severity: "CRITICAL" as const,
      title: "AWS access key found",
      description: "Hardcoded AWS access key in config.ts",
      file: "src/config.ts",
      line: 42,
      rule: "aws-access-key",
    },
    {
      scanner: "checkov",
      severity: "MEDIUM" as const,
      title: "Missing encryption at rest",
      description: "RDS instance does not have encryption enabled",
      file: "terraform/rds.tf",
      line: 8,
      rule: "rds-encryption",
    },
  ],
  summary: {
    total: 2,
    critical: 1,
    high: 0,
    medium: 1,
    low: 0,
  },
  scannersRun: ["gitleaks", "checkov"],
  scannersSkipped: [],
  durationMs: 200,
};

const lowOnlyReport = {
  id: "scan-003",
  projectPath: "/tmp/test-project",
  timestamp: "2026-04-25T10:00:00Z",
  scanType: "security" as const,
  findings: [
    {
      scanner: "npm-audit",
      severity: "LOW" as const,
      title: "Outdated package",
      description: "Package xyz has a newer version",
      file: "package.json",
      line: 10,
      rule: "outdated-dep",
    },
  ],
  summary: {
    total: 1,
    critical: 0,
    high: 0,
    medium: 0,
    low: 1,
  },
  scannersRun: ["npm-audit"],
  scannersSkipped: [],
  durationMs: 100,
};

vi.mock("@dojops/scanner", () => ({
  runScan: vi.fn(),
  planRemediation: vi.fn().mockResolvedValue({ fixes: [] }),
  applyFixes: vi.fn().mockResolvedValue({ applied: 0 }),
  compareScanReports: vi.fn().mockReturnValue({ newFindings: [], resolvedFindings: [] }),
  toSarif: vi.fn().mockReturnValue({ version: "2.1.0", runs: [] }),
  mapFindingsToCompliance: vi.fn().mockReturnValue({
    framework: "soc2",
    controls: [],
    overallScore: 100,
    passedControls: 0,
    totalControls: 0,
  }),
  getSupportedFrameworks: vi.fn().mockReturnValue(["soc2", "pci-dss"]),
  generateRemediationPlan: vi.fn().mockResolvedValue({ fixes: [] }),
}));

vi.mock("@dojops/core", () => ({
  initHookEngine: vi.fn(() => ({
    emit: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../state", () => ({
  findProjectRoot: vi.fn(() => "/tmp/test-project"),
  initProject: vi.fn(),
  appendAudit: vi.fn().mockResolvedValue(undefined),
  loadContext: vi.fn(() => null),
  saveScanReport: vi.fn(),
  listScanReports: vi.fn(() => []),
  dojopsDir: vi.fn(() => "/tmp/test-project/.dojops"),
  getCurrentUser: vi.fn(() => "test-user"),
}));

vi.mock("../../dojops-md", () => ({
  appendActivity: vi.fn(),
}));

vi.mock("../../memory", () => ({
  recordTask: vi.fn(),
}));

const mockRunHooks = vi.fn(() => true);
vi.mock("../../hooks", () => ({
  runHooks: (...args: unknown[]) => mockRunHooks(...args),
}));

vi.mock("../../ci-annotations", () => ({
  emitGitHubAnnotations: vi.fn(),
}));

import { scanCommand } from "../../commands/scan";
import { runScan } from "@dojops/scanner";
import { CLIError } from "../../exit-codes";
import type { CLIContext } from "../../types";

function makeCtx(overrides: Partial<CLIContext["globalOpts"]> = {}): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: true,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp/test-project",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

describe("scanCommand — clean scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunHooks.mockReturnValue(true);
    vi.mocked(runScan).mockResolvedValue(cleanReport);
  });

  it("completes without error on clean scan", async () => {
    await expect(scanCommand([], makeCtx())).resolves.toBeUndefined();
  });

  it("outputs JSON for --output json", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await scanCommand([], makeCtx({ output: "json" }));

    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.summary.total).toBe(0);
    expect(output.findings).toEqual([]);
    spy.mockRestore();
  });
});

describe("scanCommand — low-only findings (below default threshold)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunHooks.mockReturnValue(true);
    vi.mocked(runScan).mockResolvedValue(lowOnlyReport);
  });

  it("completes without error (low findings below default HIGH threshold)", async () => {
    await expect(scanCommand([], makeCtx())).resolves.toBeUndefined();
  });

  it("outputs JSON with low findings", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await scanCommand([], makeCtx({ output: "json" }));

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.summary.total).toBe(1);
    expect(output.summary.low).toBe(1);
    expect(output.findings).toHaveLength(1);
    spy.mockRestore();
  });

  it("fails when --fail-on=low", async () => {
    await expect(scanCommand(["--fail-on", "low"], makeCtx())).rejects.toThrow(CLIError);
  });
});

describe("scanCommand — critical findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunHooks.mockReturnValue(true);
    vi.mocked(runScan).mockResolvedValue(findingsReport);
  });

  it("fails with default threshold (HIGH) when critical findings exist", async () => {
    await expect(scanCommand([], makeCtx())).rejects.toThrow(CLIError);
  });

  it("outputs SARIF format then throws on severity", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(scanCommand([], makeCtx({ output: "sarif" }))).rejects.toThrow(CLIError);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("scanCommand — pre-scan hook failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunHooks.mockReturnValue(false);
  });

  it("throws on hook failure", async () => {
    await expect(scanCommand([], makeCtx())).rejects.toThrow("Pre-scan hook failed");
  });
});
