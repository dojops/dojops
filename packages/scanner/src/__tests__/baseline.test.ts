import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findingFingerprint,
  createBaselineFromFindings,
  filterBaselined,
  loadBaseline,
  saveBaseline,
} from "../baseline";
import type { ScanBaseline } from "../baseline";

describe("findingFingerprint", () => {
  it("produces stable hashes for the same input", () => {
    const fp1 = findingFingerprint("trivy", "CVE-2024-0001", "package.json", "vuln found");
    const fp2 = findingFingerprint("trivy", "CVE-2024-0001", "package.json", "vuln found");
    expect(fp1).toBe(fp2);
  });

  it("produces different hashes for different inputs", () => {
    const fp1 = findingFingerprint("trivy", "CVE-2024-0001", "package.json", "vuln A");
    const fp2 = findingFingerprint("trivy", "CVE-2024-0002", "package.json", "vuln B");
    expect(fp1).not.toBe(fp2);
  });

  it("returns a 16-character hex string", () => {
    const fp = findingFingerprint("npm-audit", "rule-1", "src/index.ts", "some message");
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("createBaselineFromFindings", () => {
  it("creates a valid baseline from findings", () => {
    const findings = [
      {
        scanner: "trivy",
        ruleId: "CVE-2024-0001",
        file: "Dockerfile",
        severity: "HIGH",
        message: "vuln",
      },
      { scanner: "gitleaks", file: "config.yaml", message: "secret detected" },
    ];

    const baseline = createBaselineFromFindings(findings);

    expect(baseline.version).toBe(1);
    expect(baseline.updatedAt).toBeTruthy();
    expect(baseline.entries).toHaveLength(2);

    // First entry has all fields populated
    expect(baseline.entries[0].scanner).toBe("trivy");
    expect(baseline.entries[0].ruleId).toBe("CVE-2024-0001");
    expect(baseline.entries[0].file).toBe("Dockerfile");
    expect(baseline.entries[0].severity).toBe("HIGH");
    expect(baseline.entries[0].message).toBe("vuln");
    expect(baseline.entries[0].fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(baseline.entries[0].baselinedAt).toBeTruthy();

    // Second entry defaults missing fields
    expect(baseline.entries[1].scanner).toBe("gitleaks");
    expect(baseline.entries[1].ruleId).toBe("");
    expect(baseline.entries[1].severity).toBe("unknown");
  });
});

describe("filterBaselined", () => {
  it("removes baselined findings", () => {
    const baseline: ScanBaseline = createBaselineFromFindings([
      {
        scanner: "trivy",
        ruleId: "CVE-2024-0001",
        file: "Dockerfile",
        severity: "HIGH",
        message: "vuln",
      },
    ]);

    const findings = [
      { scanner: "trivy", ruleId: "CVE-2024-0001", file: "Dockerfile", message: "vuln" },
      { scanner: "trivy", ruleId: "CVE-2024-0002", file: "Dockerfile", message: "new vuln" },
    ];

    const filtered = filterBaselined(findings, baseline);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].ruleId).toBe("CVE-2024-0002");
  });

  it("keeps new findings not in the baseline", () => {
    const baseline: ScanBaseline = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: [],
    };

    const findings = [
      { scanner: "npm-audit", ruleId: "rule-1", file: "package.json", message: "outdated dep" },
      { scanner: "trivy", message: "container vuln" },
    ];

    const filtered = filterBaselined(findings, baseline);
    expect(filtered).toHaveLength(2);
  });

  it("handles findings with missing optional fields", () => {
    const baseline: ScanBaseline = createBaselineFromFindings([
      { scanner: "gitleaks", message: "secret detected" },
    ]);

    const findings = [
      { scanner: "gitleaks", message: "secret detected" },
      { scanner: "gitleaks", message: "different secret" },
    ];

    const filtered = filterBaselined(findings, baseline);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].message).toBe("different secret");
  });
});

describe("loadBaseline", () => {
  it("returns null for missing file", () => {
    const result = loadBaseline("/nonexistent/path");
    expect(result).toBeNull();
  });

  it("returns null for invalid version", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-test-"));
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "scan-baseline.json"),
      JSON.stringify({ version: 99, entries: [] }),
    );

    const result = loadBaseline(tmpDir);
    expect(result).toBeNull();

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("saveBaseline and loadBaseline round-trip", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-roundtrip-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a baseline through save and load", () => {
    const baseline: ScanBaseline = createBaselineFromFindings([
      {
        scanner: "trivy",
        ruleId: "CVE-2024-0001",
        file: "Dockerfile",
        severity: "CRITICAL",
        message: "vuln",
      },
      {
        scanner: "npm-audit",
        ruleId: "GHSA-1234",
        file: "package.json",
        severity: "HIGH",
        message: "dep issue",
      },
    ]);

    saveBaseline(tmpDir, baseline);
    const loaded = loadBaseline(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.entries).toHaveLength(2);
    expect(loaded!.entries[0].fingerprint).toBe(baseline.entries[0].fingerprint);
    expect(loaded!.entries[1].fingerprint).toBe(baseline.entries[1].fingerprint);
    expect(loaded!.updatedAt).toBe(baseline.updatedAt);
  });

  it("creates .dojops directory if it does not exist", () => {
    const baseline: ScanBaseline = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: [],
    };

    saveBaseline(tmpDir, baseline);

    const filePath = path.join(tmpDir, ".dojops", "scan-baseline.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
