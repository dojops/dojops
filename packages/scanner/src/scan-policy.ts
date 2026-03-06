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
/** Apply ignore list to a report, filtering out suppressed findings. Returns count of suppressed. */
function applyIgnoreList(report: ScanReport, ignoreEntries: ScanPolicyIgnoreEntry[]): number {
  if (ignoreEntries.length === 0) return 0;
  const ignoreIds = new Set(ignoreEntries.map((e) => e.id));
  const originalCount = report.findings.length;
  report.findings = report.findings.filter(
    (f) => !ignoreIds.has(f.id) && !ignoreIds.has(f.cve ?? ""),
  );
  const suppressedCount = originalCount - report.findings.length;
  if (suppressedCount > 0) {
    report.summary = {
      total: report.findings.length,
      critical: report.findings.filter((f) => f.severity === "CRITICAL").length,
      high: report.findings.filter((f) => f.severity === "HIGH").length,
      medium: report.findings.filter((f) => f.severity === "MEDIUM").length,
      low: report.findings.filter((f) => f.severity === "LOW").length,
    };
  }
  return suppressedCount;
}

/** Check severity thresholds and collect violation messages. */
function checkThresholds(report: ScanReport, thresholds: ScanPolicyThresholds): string[] {
  const violations: string[] = [];
  const criticalCount = report.findings.filter((f) => f.severity === "CRITICAL").length;
  const highCount = report.findings.filter((f) => f.severity === "HIGH").length;
  if (thresholds.critical !== undefined && criticalCount > thresholds.critical) {
    violations.push(
      `CRITICAL findings (${criticalCount}) exceed threshold (${thresholds.critical})`,
    );
  }
  if (thresholds.high !== undefined && highCount > thresholds.high) {
    violations.push(`HIGH findings (${highCount}) exceed threshold (${thresholds.high})`);
  }
  return violations;
}

export function evaluatePolicy(report: ScanReport, policy: ScanPolicy): PolicyResult {
  const suppressedCount = policy.ignore ? applyIgnoreList(report, policy.ignore) : 0;
  const violations = policy.thresholds ? checkThresholds(report, policy.thresholds) : [];
  return { passed: violations.length === 0, violations, suppressedCount };
}

/**
 * Minimal YAML parser for scan-policy.yaml.
 * Supports the specific schema: thresholds.critical, thresholds.high, ignore[].id, ignore[].reason
 */
/** Strip surrounding quotes from a YAML value string. */
function stripQuotes(value: string): string {
  return value.trim().replaceAll(/^["']|["']$/g, "");
}

/** Parse an integer from a "key: value" YAML line. Returns undefined on failure. */
function parseThresholdValue(stripped: string): number | undefined {
  const val = Number.parseInt(stripped.split(":")[1].trim(), 10);
  return Number.isNaN(val) ? undefined : val;
}

function parseScanPolicyYaml(content: string): ScanPolicy {
  const policy: ScanPolicy = {};
  const lines = content.split("\n");
  let inThresholds = false;
  let inIgnore = false;
  let currentIgnoreEntry: Partial<ScanPolicyIgnoreEntry> | null = null;

  for (const raw of lines) {
    const stripped = raw.trimEnd().trim();

    if (!stripped || stripped.startsWith("#")) continue;

    // Detect top-level section switches
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

    // Unknown top-level key resets context (must be checked before section parsing)
    if (!stripped.startsWith(" ") && !stripped.startsWith("-") && stripped.endsWith(":")) {
      inThresholds = false;
      inIgnore = false;
      continue;
    }

    if (inThresholds) {
      if (stripped.startsWith("critical:")) {
        const val = parseThresholdValue(stripped);
        if (val !== undefined) policy.thresholds!.critical = val;
      } else if (stripped.startsWith("high:")) {
        const val = parseThresholdValue(stripped);
        if (val !== undefined) policy.thresholds!.high = val;
      }
      continue;
    }

    if (inIgnore) {
      if (stripped.startsWith("- id:")) {
        if (currentIgnoreEntry?.id) {
          policy.ignore!.push(currentIgnoreEntry as ScanPolicyIgnoreEntry);
        }
        currentIgnoreEntry = { id: stripQuotes(stripped.slice(5)) };
      } else if (stripped.startsWith("reason:") && currentIgnoreEntry) {
        currentIgnoreEntry.reason = stripQuotes(stripped.slice(7));
      }
      continue;
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
