/**
 * SARIF 2.1.0 output formatter for scan reports.
 *
 * Transforms DojOps ScanReport findings into SARIF format for integration
 * with GitHub Code Scanning, GitLab SAST, and other SARIF-compatible tools.
 */
import type { ScanReport, ScanFinding, ScanSeverity } from "./types";

/** Map DojOps severity to SARIF result level. */
function toSarifLevel(severity: ScanSeverity): "error" | "warning" | "note" {
  switch (severity) {
    case "CRITICAL":
    case "HIGH":
      return "error";
    case "MEDIUM":
      return "warning";
    case "LOW":
      return "note";
  }
}

/** Map DojOps severity to SARIF security-severity score (for Code Scanning). */
function toSecuritySeverity(severity: ScanSeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "9.0";
    case "HIGH":
      return "7.0";
    case "MEDIUM":
      return "4.0";
    case "LOW":
      return "1.0";
  }
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  properties?: Record<string, unknown>;
}

interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine: number };
    };
  }>;
  properties?: Record<string, unknown>;
}

function groupFindingsByTool(report: ScanReport): Map<string, ScanFinding[]> {
  const map = new Map<string, ScanFinding[]>();
  for (const scanner of report.scannersRun) {
    map.set(scanner, []);
  }
  for (const finding of report.findings) {
    const existing = map.get(finding.tool) ?? [];
    existing.push(finding);
    map.set(finding.tool, existing);
  }
  return map;
}

function buildSarifRule(finding: ScanFinding): SarifRule {
  const rule: SarifRule = {
    id: finding.id,
    shortDescription: { text: finding.message },
    properties: {
      "security-severity": toSecuritySeverity(finding.severity),
    },
  };
  if (finding.recommendation) {
    rule.fullDescription = { text: finding.recommendation };
  }
  return rule;
}

function buildResultProperties(finding: ScanFinding): Record<string, unknown> {
  const props: Record<string, unknown> = {
    category: finding.category,
    severity: finding.severity,
  };
  if (finding.cve) props.cve = finding.cve;
  if (finding.cvss !== undefined) props.cvss = finding.cvss;
  if (finding.cwe) props.cwe = finding.cwe;
  if (finding.fixVersion) props.fixVersion = finding.fixVersion;
  return props;
}

function buildSarifResult(finding: ScanFinding): SarifResult {
  const result: SarifResult = {
    ruleId: finding.id,
    level: toSarifLevel(finding.severity),
    message: { text: finding.message },
  };

  if (finding.file) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.file },
          ...(finding.line ? { region: { startLine: finding.line } } : {}),
        },
      },
    ];
  }

  result.properties = buildResultProperties(finding);
  return result;
}

function buildSarifRun(
  toolName: string,
  findings: ScanFinding[],
): { tool: object; results: SarifResult[] } {
  const rulesMap = new Map<string, SarifRule>();
  const results: SarifResult[] = [];

  for (const finding of findings) {
    if (!rulesMap.has(finding.id)) {
      rulesMap.set(finding.id, buildSarifRule(finding));
    }
    results.push(buildSarifResult(finding));
  }

  return {
    tool: {
      driver: {
        name: `dojops-scanner/${toolName}`,
        version: "1.0.0",
        informationUri: "https://dojops.ai",
        rules: [...rulesMap.values()],
      },
    },
    results,
  };
}

/**
 * Transform a DojOps ScanReport into SARIF 2.1.0 format.
 *
 * Each scanner that produced findings becomes a separate `run` with its own `tool`.
 * If a scanner produced no findings, it is still included as an empty run.
 */
export function toSarif(report: ScanReport): object {
  const findingsByTool = groupFindingsByTool(report);
  const runs = [];
  for (const [toolName, findings] of findingsByTool) {
    runs.push(buildSarifRun(toolName, findings));
  }

  return {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs,
  };
}
