import fs from "node:fs";
import path from "node:path";
import type { ScanFinding } from "./types";

// ── Types ─────────────────────────────────────────────────────────

export interface ComplianceControl {
  controlId: string;
  description: string;
  checkovIds?: string[];
}

export interface ComplianceFrameworkDef {
  framework: string;
  version: string;
  description: string;
  controls: ComplianceControl[];
}

export interface ComplianceControlResult {
  controlId: string;
  description: string;
  status: "pass" | "fail" | "partial";
  findings: ScanFinding[];
}

export interface ComplianceReport {
  framework: string;
  version: string;
  description: string;
  timestamp: string;
  summary: {
    totalControls: number;
    passing: number;
    failing: number;
    partial: number;
    compliancePercentage: number;
  };
  controls: ComplianceControlResult[];
}

// ── Supported frameworks ──────────────────────────────────────────

const SUPPORTED_FRAMEWORKS = ["soc2", "hipaa", "pci-dss"];

export function getSupportedFrameworks(): string[] {
  return [...SUPPORTED_FRAMEWORKS];
}

// ── Framework loading ─────────────────────────────────────────────

function loadFrameworkDef(framework: string): ComplianceFrameworkDef {
  const normalized = framework.toLowerCase().replace(/\s+/g, "-");

  if (!SUPPORTED_FRAMEWORKS.includes(normalized)) {
    throw new Error(
      `Unsupported compliance framework: "${framework}". ` +
        `Supported: ${SUPPORTED_FRAMEWORKS.join(", ")}`,
    );
  }

  // Try multiple locations: dist/ (compiled), src/ (development)
  const candidates = [
    path.join(__dirname, "compliance-frameworks", `${normalized}.json`),
    path.join(__dirname, "..", "src", "compliance-frameworks", `${normalized}.json`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, "utf-8");
      return JSON.parse(content) as ComplianceFrameworkDef;
    }
  }

  throw new Error(`Compliance framework definition not found for "${framework}".`);
}

// ── Mapping logic ─────────────────────────────────────────────────

/**
 * Build a reverse mapping from Checkov check IDs to compliance control IDs.
 */
function buildCheckovToControlMap(
  frameworkDef: ComplianceFrameworkDef,
): Map<string, ComplianceControl[]> {
  const map = new Map<string, ComplianceControl[]>();

  for (const control of frameworkDef.controls) {
    if (!control.checkovIds) continue;
    for (const checkovId of control.checkovIds) {
      const existing = map.get(checkovId) ?? [];
      existing.push(control);
      map.set(checkovId, existing);
    }
  }

  return map;
}

/**
 * Map scan findings to compliance controls for a given framework.
 * Matches findings based on their tool ID (Checkov check IDs).
 */
export function mapFindingsToCompliance(
  findings: ScanFinding[],
  framework: string,
): ComplianceReport {
  const frameworkDef = loadFrameworkDef(framework);
  const checkovMap = buildCheckovToControlMap(frameworkDef);

  // Track which controls have violations
  const controlFindings = new Map<string, ScanFinding[]>();

  for (const finding of findings) {
    // Match by finding ID (e.g., "CKV_AWS_40") or by the ID field
    const findingId = finding.id;

    // Check direct match against Checkov IDs
    const matchedControls = checkovMap.get(findingId);
    if (matchedControls) {
      for (const control of matchedControls) {
        const existing = controlFindings.get(control.controlId) ?? [];
        existing.push(finding);
        controlFindings.set(control.controlId, existing);
      }
    }
  }

  // Build control results
  const controls: ComplianceControlResult[] = frameworkDef.controls.map((control) => {
    const relatedFindings = controlFindings.get(control.controlId) ?? [];
    const hasCriticalOrHigh = relatedFindings.some(
      (f) => f.severity === "CRITICAL" || f.severity === "HIGH",
    );

    let status: ComplianceControlResult["status"];
    if (relatedFindings.length === 0) {
      status = "pass";
    } else if (hasCriticalOrHigh) {
      status = "fail";
    } else {
      status = "partial";
    }

    return {
      controlId: control.controlId,
      description: control.description,
      status,
      findings: relatedFindings,
    };
  });

  // Compute summary
  const passing = controls.filter((c) => c.status === "pass").length;
  const failing = controls.filter((c) => c.status === "fail").length;
  const partial = controls.filter((c) => c.status === "partial").length;
  const totalControls = controls.length;
  const compliancePercentage =
    totalControls > 0 ? Math.round((passing / totalControls) * 100) : 100;

  return {
    framework: frameworkDef.framework,
    version: frameworkDef.version,
    description: frameworkDef.description,
    timestamp: new Date().toISOString(),
    summary: {
      totalControls,
      passing,
      failing,
      partial,
      compliancePercentage,
    },
    controls,
  };
}
