import * as fs from "node:fs";
import * as path from "node:path";
import type { ScanReport } from "./types";

export interface ScanPolicyThresholds {
  critical?: number;
  high?: number;
}

export interface ScanPolicyIgnoreEntry {
  id: string;
  reason: string;
}

export interface ScanPolicy {
  thresholds?: ScanPolicyThresholds;
  ignore?: ScanPolicyIgnoreEntry[];
}

export interface PolicyResult {
  passed: boolean;
  violations: string[];
  suppressedCount: number;
}

/**
 * Load scan policy from `.dojops/scan-policy.yaml` in the given project path.
 * Returns undefined if no policy file exists.
 */
export function loadScanPolicy(projectPath: string): ScanPolicy | undefined {
  const policyPath = path.join(projectPath, ".dojops", "scan-policy.yaml");
  if (!fs.existsSync(policyPath)) return undefined;

  try {
    const content = fs.readFileSync(policyPath, "utf-8");
    // Simple YAML parser for the flat schema we support
    return parseScanPolicyYaml(content);
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a scan report against a policy.
 * Returns pass/fail status with violation details.
 * Also filters out ignored findings from the report (side-effect on report.findings).
 */
export function evaluatePolicy(report: ScanReport, policy: ScanPolicy): PolicyResult {
  const violations: string[] = [];
  let suppressedCount = 0;

  // Apply ignore list — filter suppressed findings and recompute summary
  if (policy.ignore && policy.ignore.length > 0) {
    const ignoreIds = new Set(policy.ignore.map((e) => e.id));
    const originalFindings = [...report.findings];
    report.findings = originalFindings.filter(
      (f) => !ignoreIds.has(f.id) && !ignoreIds.has(f.cve ?? ""),
    );
    suppressedCount = originalFindings.length - report.findings.length;

    // Recompute summary to match filtered findings
    if (suppressedCount > 0) {
      report.summary = {
        total: report.findings.length,
        critical: report.findings.filter((f) => f.severity === "CRITICAL").length,
        high: report.findings.filter((f) => f.severity === "HIGH").length,
        medium: report.findings.filter((f) => f.severity === "MEDIUM").length,
        low: report.findings.filter((f) => f.severity === "LOW").length,
      };
    }
  }

  // Check severity count thresholds
  if (policy.thresholds) {
    const criticalCount = report.findings.filter((f) => f.severity === "CRITICAL").length;
    const highCount = report.findings.filter((f) => f.severity === "HIGH").length;

    if (policy.thresholds.critical !== undefined && criticalCount > policy.thresholds.critical) {
      violations.push(
        `CRITICAL findings (${criticalCount}) exceed threshold (${policy.thresholds.critical})`,
      );
    }
    if (policy.thresholds.high !== undefined && highCount > policy.thresholds.high) {
      violations.push(`HIGH findings (${highCount}) exceed threshold (${policy.thresholds.high})`);
    }
  }

  return { passed: violations.length === 0, violations, suppressedCount };
}

/**
 * Minimal YAML parser for scan-policy.yaml.
 * Supports the specific schema: thresholds.critical, thresholds.high, ignore[].id, ignore[].reason
 */
function parseScanPolicyYaml(content: string): ScanPolicy {
  const policy: ScanPolicy = {};
  const lines = content.split("\n");
  let inThresholds = false;
  let inIgnore = false;
  let currentIgnoreEntry: Partial<ScanPolicyIgnoreEntry> | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const stripped = line.trim();

    // Skip comments and empty lines
    if (!stripped || stripped.startsWith("#")) continue;

    if (stripped === "thresholds:") {
      inThresholds = true;
      inIgnore = false;
      policy.thresholds = {};
      continue;
    }

    if (stripped === "ignore:") {
      inIgnore = true;
      inThresholds = false;
      policy.ignore = [];
      continue;
    }

    if (inThresholds && stripped.startsWith("critical:")) {
      const val = Number.parseInt(stripped.split(":")[1].trim(), 10);
      if (!isNaN(val)) policy.thresholds!.critical = val;
      continue;
    }

    if (inThresholds && stripped.startsWith("high:")) {
      const val = Number.parseInt(stripped.split(":")[1].trim(), 10);
      if (!isNaN(val)) policy.thresholds!.high = val;
      continue;
    }

    if (inIgnore) {
      if (stripped.startsWith("- id:")) {
        // Push previous entry if any
        if (currentIgnoreEntry?.id) {
          policy.ignore!.push(currentIgnoreEntry as ScanPolicyIgnoreEntry);
        }
        currentIgnoreEntry = {
          id: stripped
            .slice(5)
            .trim()
            .replaceAll(/^["']|["']$/g, ""),
        };
        continue;
      }
      if (stripped.startsWith("reason:") && currentIgnoreEntry) {
        currentIgnoreEntry.reason = stripped
          .slice(7)
          .trim()
          .replaceAll(/^["']|["']$/g, "");
        continue;
      }
    }

    // If we hit a top-level key, reset context
    if (!stripped.startsWith(" ") && !stripped.startsWith("-") && stripped.endsWith(":")) {
      inThresholds = false;
      inIgnore = false;
    }
  }

  // Push last ignore entry
  if (currentIgnoreEntry?.id && inIgnore) {
    policy.ignore!.push({
      id: currentIgnoreEntry.id,
      reason: currentIgnoreEntry.reason ?? "",
    });
  }

  return policy;
}
