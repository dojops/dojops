import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ScanReport, ScanFinding } from "../types";

// Mock node:fs at module level so loadScanPolicy gets the mocked version
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
  };
});

// Import after mock so loadScanPolicy uses the mocked fs
import * as fs from "node:fs";
import { evaluatePolicy, loadScanPolicy } from "../scan-policy";
import type { ScanPolicy } from "../scan-policy";

// ── Helpers ──────────────────────────────────────────────────────────

function makeFinding(
  overrides: Partial<ScanFinding> & { id: string; severity: ScanFinding["severity"] },
): ScanFinding {
  return {
    tool: "trivy",
    category: "SECURITY",
    message: "test finding",
    autoFixAvailable: false,
    ...overrides,
  };
}

function makeReport(findings: ScanFinding[]): ScanReport {
  return {
    id: "scan-test",
    projectPath: "/project",
    timestamp: new Date().toISOString(),
    scanType: "security",
    scannersRun: ["trivy"],
    scannersSkipped: [],
    findings,
    summary: {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "CRITICAL").length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
      low: findings.filter((f) => f.severity === "LOW").length,
    },
    durationMs: 100,
  };
}

// ── evaluatePolicy ──────────────────────────────────────────────────

describe("evaluatePolicy", () => {
  describe("mutation side-effect (FB3)", () => {
    it("mutates report.findings in-place when applying ignore list", () => {
      const report = makeReport([
        makeFinding({ id: "CVE-2024-001", severity: "CRITICAL" }),
        makeFinding({ id: "CVE-2024-002", severity: "HIGH" }),
        makeFinding({ id: "CVE-2024-003", severity: "MEDIUM" }),
      ]);

      const originalFindings = report.findings; // Same reference
      const policy: ScanPolicy = {
        ignore: [{ id: "CVE-2024-001", reason: "false positive" }],
      };

      evaluatePolicy(report, policy);

      // The report.findings array was replaced (filter returns a new array)
      // so the original reference is stale
      expect(report.findings).not.toBe(originalFindings);
      expect(report.findings).toHaveLength(2);
      expect(report.findings.find((f) => f.id === "CVE-2024-001")).toBeUndefined();
    });

    it("does not mutate findings when ignore list is empty", () => {
      const report = makeReport([makeFinding({ id: "CVE-2024-001", severity: "CRITICAL" })]);

      const originalFindings = report.findings;
      const policy: ScanPolicy = { ignore: [] };

      evaluatePolicy(report, policy);

      // Empty ignore array does not trigger filtering (length > 0 check)
      expect(report.findings).toBe(originalFindings);
      expect(report.findings).toHaveLength(1);
    });
  });

  describe("threshold checks", () => {
    it("passes when findings are within thresholds", () => {
      const report = makeReport([makeFinding({ id: "1", severity: "CRITICAL" })]);
      const policy: ScanPolicy = { thresholds: { critical: 1 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("passes when findings are exactly at threshold", () => {
      const report = makeReport([makeFinding({ id: "1", severity: "CRITICAL" })]);
      // threshold of 1 means at most 1 is allowed (> check, not >=)
      const policy: ScanPolicy = { thresholds: { critical: 1 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(true);
    });

    it("fails when critical findings exceed threshold", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "CRITICAL" }),
        makeFinding({ id: "2", severity: "CRITICAL" }),
      ]);
      const policy: ScanPolicy = { thresholds: { critical: 1 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("CRITICAL findings (2) exceed threshold (1)");
    });

    it("fails when high findings exceed threshold", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "HIGH" }),
        makeFinding({ id: "2", severity: "HIGH" }),
        makeFinding({ id: "3", severity: "HIGH" }),
      ]);
      const policy: ScanPolicy = { thresholds: { high: 2 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("HIGH findings (3) exceed threshold (2)");
    });

    it("checks both critical and high thresholds independently", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "CRITICAL" }),
        makeFinding({ id: "2", severity: "CRITICAL" }),
        makeFinding({ id: "3", severity: "HIGH" }),
        makeFinding({ id: "4", severity: "HIGH" }),
        makeFinding({ id: "5", severity: "HIGH" }),
      ]);
      const policy: ScanPolicy = { thresholds: { critical: 1, high: 2 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations[0]).toContain("CRITICAL");
      expect(result.violations[1]).toContain("HIGH");
    });

    it("allows zero as a valid threshold", () => {
      const report = makeReport([makeFinding({ id: "1", severity: "CRITICAL" })]);
      const policy: ScanPolicy = { thresholds: { critical: 0 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("CRITICAL findings (1) exceed threshold (0)");
    });

    it("passes when zero threshold and zero findings", () => {
      const report = makeReport([]);
      const policy: ScanPolicy = { thresholds: { critical: 0, high: 0 } };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(true);
    });

    it("ignores MEDIUM and LOW findings when checking thresholds", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "MEDIUM" }),
        makeFinding({ id: "2", severity: "LOW" }),
        makeFinding({ id: "3", severity: "MEDIUM" }),
      ]);
      const policy: ScanPolicy = { thresholds: { critical: 0, high: 0 } };
      const result = evaluatePolicy(report, policy);
      // MEDIUM and LOW are not checked by thresholds
      expect(result.passed).toBe(true);
    });
  });

  describe("ignore by CVE field", () => {
    it("ignores findings by CVE field (not by id)", () => {
      const report = makeReport([
        makeFinding({ id: "VULN-1", severity: "CRITICAL", cve: "CVE-2024-999" }),
      ]);
      const policy: ScanPolicy = {
        ignore: [{ id: "CVE-2024-999", reason: "resolved upstream" }],
      };
      evaluatePolicy(report, policy);
      expect(report.findings).toHaveLength(0);
    });

    it("ignores findings by id field when no cve present", () => {
      const report = makeReport([makeFinding({ id: "CVE-2024-999", severity: "CRITICAL" })]);
      const policy: ScanPolicy = {
        ignore: [{ id: "CVE-2024-999", reason: "resolved" }],
      };
      evaluatePolicy(report, policy);
      expect(report.findings).toHaveLength(0);
    });

    it("does not ignore findings where neither id nor cve matches", () => {
      const report = makeReport([
        makeFinding({ id: "VULN-1", severity: "CRITICAL", cve: "CVE-2024-888" }),
      ]);
      const policy: ScanPolicy = {
        ignore: [{ id: "CVE-2024-999", reason: "wrong one" }],
      };
      evaluatePolicy(report, policy);
      expect(report.findings).toHaveLength(1);
    });

    it("ignores multiple findings with multiple ignore entries", () => {
      const report = makeReport([
        makeFinding({ id: "f1", severity: "CRITICAL", cve: "CVE-2024-001" }),
        makeFinding({ id: "f2", severity: "HIGH", cve: "CVE-2024-002" }),
        makeFinding({ id: "f3", severity: "MEDIUM" }),
      ]);
      const policy: ScanPolicy = {
        ignore: [
          { id: "CVE-2024-001", reason: "fp" },
          { id: "f3", reason: "accepted" },
        ],
      };
      evaluatePolicy(report, policy);
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].id).toBe("f2");
    });
  });

  describe("combined ignore and thresholds", () => {
    it("applies ignore before threshold check", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "CRITICAL" }),
        makeFinding({ id: "2", severity: "CRITICAL" }),
      ]);
      const policy: ScanPolicy = {
        ignore: [{ id: "1", reason: "fp" }],
        thresholds: { critical: 1 },
      };
      const result = evaluatePolicy(report, policy);
      // After ignoring "1", only 1 CRITICAL remains, which is within threshold
      expect(result.passed).toBe(true);
      expect(report.findings).toHaveLength(1);
    });

    it("still fails when ignore does not bring count below threshold", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "CRITICAL" }),
        makeFinding({ id: "2", severity: "CRITICAL" }),
        makeFinding({ id: "3", severity: "CRITICAL" }),
      ]);
      const policy: ScanPolicy = {
        ignore: [{ id: "1", reason: "fp" }],
        thresholds: { critical: 1 },
      };
      const result = evaluatePolicy(report, policy);
      expect(result.passed).toBe(false);
      expect(report.findings).toHaveLength(2);
    });
  });

  describe("empty / missing policy sections", () => {
    it("passes with empty policy object", () => {
      const report = makeReport([makeFinding({ id: "1", severity: "CRITICAL" })]);
      const result = evaluatePolicy(report, {});
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("passes with undefined thresholds and ignore", () => {
      const report = makeReport([
        makeFinding({ id: "1", severity: "CRITICAL" }),
        makeFinding({ id: "2", severity: "HIGH" }),
      ]);
      const result = evaluatePolicy(report, { thresholds: undefined, ignore: undefined });
      expect(result.passed).toBe(true);
    });

    it("passes with thresholds present but no critical/high fields set", () => {
      const report = makeReport([makeFinding({ id: "1", severity: "CRITICAL" })]);
      const policy: ScanPolicy = { thresholds: {} };
      const result = evaluatePolicy(report, policy);
      // Neither critical nor high threshold is defined, so no violations
      expect(result.passed).toBe(true);
    });
  });
});

// ── loadScanPolicy ──────────────────────────────────────────────────

describe("loadScanPolicy", () => {
  const mockedExistsSync = vi.mocked(fs.existsSync);
  const mockedReadFileSync = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    mockedExistsSync.mockReset();
    mockedReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no policy file exists", () => {
    mockedExistsSync.mockReturnValue(false);
    const result = loadScanPolicy("/nonexistent");
    expect(result).toBeUndefined();
  });

  it("parses threshold-only policy", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("thresholds:\n  critical: 0\n  high: 5\n");
    const policy = loadScanPolicy("/project");
    expect(policy).toEqual({ thresholds: { critical: 0, high: 5 } });
  });

  it("parses ignore-only policy", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      'ignore:\n  - id: CVE-2024-001\n    reason: "false positive"\n  - id: CVE-2024-002\n    reason: accepted risk\n',
    );
    const policy = loadScanPolicy("/project");
    expect(policy!.ignore).toHaveLength(2);
    expect(policy!.ignore![0]).toEqual({ id: "CVE-2024-001", reason: "false positive" });
    expect(policy!.ignore![1]).toEqual({ id: "CVE-2024-002", reason: "accepted risk" });
  });

  it("parses policy with comments and empty lines", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "# DojOps scan policy\n\nthresholds:\n  # Max critical vulns\n  critical: 0\n\n# Suppressions\nignore:\n  - id: CVE-2024-001\n    reason: resolved upstream\n",
    );
    const policy = loadScanPolicy("/project");
    expect(policy!.thresholds!.critical).toBe(0);
    expect(policy!.ignore).toHaveLength(1);
  });

  it("handles threshold value of zero", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("thresholds:\n  critical: 0\n");
    const policy = loadScanPolicy("/project");
    expect(policy!.thresholds!.critical).toBe(0);
  });

  it("handles last ignore entry without trailing newline", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("ignore:\n  - id: CVE-2024-001\n    reason: test");
    const policy = loadScanPolicy("/project");
    expect(policy!.ignore).toHaveLength(1);
    expect(policy!.ignore![0].id).toBe("CVE-2024-001");
    expect(policy!.ignore![0].reason).toBe("test");
  });

  it("handles non-numeric threshold values gracefully", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("thresholds:\n  critical: abc\n");
    const policy = loadScanPolicy("/project");
    // Number.parseInt("abc") is NaN, so the value is not assigned
    expect(policy!.thresholds!.critical).toBeUndefined();
  });

  it("handles ignore entry without reason field", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("ignore:\n  - id: CVE-2024-001\n");
    const policy = loadScanPolicy("/project");
    // The entry should still be captured with empty reason (default)
    expect(policy!.ignore).toHaveLength(1);
    expect(policy!.ignore![0].reason).toBe("");
  });

  it("returns undefined on read error (EACCES)", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    const policy = loadScanPolicy("/project");
    expect(policy).toBeUndefined();
  });

  it("parses full policy with both thresholds and ignore", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "thresholds:\n  critical: 0\n  high: 10\nignore:\n  - id: CVE-2024-001\n    reason: false positive\n  - id: CVE-2024-002\n    reason: accepted\n",
    );
    const policy = loadScanPolicy("/project");
    expect(policy!.thresholds).toEqual({ critical: 0, high: 10 });
    expect(policy!.ignore).toHaveLength(2);
    expect(policy!.ignore![0].id).toBe("CVE-2024-001");
    expect(policy!.ignore![1].id).toBe("CVE-2024-002");
  });

  it("strips quotes from id and reason values", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "ignore:\n  - id: \"CVE-2024-001\"\n    reason: 'some reason'\n",
    );
    const policy = loadScanPolicy("/project");
    expect(policy!.ignore![0].id).toBe("CVE-2024-001");
    expect(policy!.ignore![0].reason).toBe("some reason");
  });

  it("handles multiple ignore entries where middle ones have no reason", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "ignore:\n  - id: CVE-2024-001\n  - id: CVE-2024-002\n    reason: accepted\n",
    );
    const policy = loadScanPolicy("/project");
    // First entry has no reason, gets pushed when second "- id:" is encountered
    // The push at line 123-124 uses `as ScanPolicyIgnoreEntry` without setting reason
    expect(policy!.ignore).toHaveLength(2);
    expect(policy!.ignore![0].id).toBe("CVE-2024-001");
    expect(policy!.ignore![1].id).toBe("CVE-2024-002");
    expect(policy!.ignore![1].reason).toBe("accepted");
  });

  it("returns empty policy for empty file content", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("");
    const policy = loadScanPolicy("/project");
    expect(policy).toEqual({});
  });

  it("returns empty policy for comment-only file", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("# This is a comment\n# Another comment\n");
    const policy = loadScanPolicy("/project");
    expect(policy).toEqual({});
  });

  it("resets context when an unknown top-level key appears", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      "thresholds:\n  critical: 5\nunknownSection:\n  critical: 99\n",
    );
    const policy = loadScanPolicy("/project");
    // After "unknownSection:", inThresholds is reset, so "critical: 99" is not parsed as threshold
    expect(policy!.thresholds!.critical).toBe(5);
  });
});
