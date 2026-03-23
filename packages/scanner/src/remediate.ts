import type { ScanFinding } from "./types";

// ── Types ─────────────────────────────────────────────────────────

export interface RemediationAction {
  finding: ScanFinding;
  action: "update" | "patch" | "configure" | "remove" | "manual";
  description: string;
  command?: string;
  confidence: "high" | "medium" | "low";
}

export interface AutoRemediationPlan {
  actions: RemediationAction[];
  autoFixable: number;
  manualRequired: number;
  summary: string;
}

// ── Tool-based remediation generators ─────────────────────────────

/** Generate npm audit fix commands for dependency vulnerabilities. */
export function remediateNpmFindings(findings: ScanFinding[]): RemediationAction[] {
  const npmFindings = findings.filter((f) => f.tool === "npm-audit");
  if (npmFindings.length === 0) return [];

  const actions: RemediationAction[] = [];

  for (const finding of npmFindings) {
    if (finding.fixVersion) {
      // Extract package name from message — npm-audit messages typically start with "package-name:"
      const pkgName = extractPackageName(finding.message);
      actions.push({
        finding,
        action: "update",
        description: `Update ${pkgName || "package"} to ${finding.fixVersion}`,
        command: pkgName ? `npm install ${pkgName}@${finding.fixVersion}` : `npm audit fix`,
        confidence: "high",
      });
    } else if (finding.autoFixAvailable) {
      actions.push({
        finding,
        action: "update",
        description: `Run npm audit fix for ${finding.message}`,
        command: "npm audit fix",
        confidence: "medium",
      });
    } else {
      actions.push({
        finding,
        action: "manual",
        description: `No automatic fix available. ${finding.recommendation ?? "Review and update manually."}`,
        confidence: "low",
      });
    }
  }

  return actions;
}

/** Generate pip install --upgrade commands for Python vulnerabilities. */
export function remediatePipFindings(findings: ScanFinding[]): RemediationAction[] {
  const pipFindings = findings.filter((f) => f.tool === "pip-audit");
  if (pipFindings.length === 0) return [];

  const actions: RemediationAction[] = [];

  for (const finding of pipFindings) {
    if (finding.fixVersion) {
      const pkgName = extractPackageName(finding.message);
      actions.push({
        finding,
        action: "update",
        description: `Upgrade ${pkgName || "package"} to ${finding.fixVersion}`,
        command: pkgName
          ? `pip install --upgrade ${pkgName}==${finding.fixVersion}`
          : `pip install --upgrade`,
        confidence: "high",
      });
    } else {
      actions.push({
        finding,
        action: "manual",
        description: `No fixed version available. ${finding.recommendation ?? "Check upstream for patches."}`,
        confidence: "low",
      });
    }
  }

  return actions;
}

/** Generate remediation actions for IaC findings (checkov, trivy). */
export function remediateIacFindings(findings: ScanFinding[]): RemediationAction[] {
  const iacTools = new Set(["checkov", "trivy"]);
  const iacFindings = findings.filter((f) => iacTools.has(f.tool) && f.category === "IAC");
  if (iacFindings.length === 0) return [];

  return iacFindings.map((finding) => ({
    finding,
    action: "manual" as const,
    description: finding.recommendation ?? `Review IaC configuration: ${finding.message}`,
    confidence: "medium" as const,
  }));
}

/** Generate remediation actions for secrets findings (gitleaks). */
export function remediateSecretFindings(findings: ScanFinding[]): RemediationAction[] {
  const secretFindings = findings.filter((f) => f.tool === "gitleaks" || f.category === "SECRETS");
  if (secretFindings.length === 0) return [];

  return secretFindings.map((finding) => ({
    finding,
    action: "manual" as const,
    description: "Rotate credential and remove from git history",
    confidence: "high" as const,
  }));
}

/** Generate remediation actions for Dockerfile findings (hadolint). */
export function remediateHadolintFindings(findings: ScanFinding[]): RemediationAction[] {
  const hadolintFindings = findings.filter((f) => f.tool === "hadolint");
  if (hadolintFindings.length === 0) return [];

  return hadolintFindings.map((finding) => ({
    finding,
    action: "configure" as const,
    description: finding.recommendation ?? `Dockerfile: ${finding.message}`,
    confidence: "medium" as const,
  }));
}

/** Generate remediation actions for shellcheck findings. */
export function remediateShellcheckFindings(findings: ScanFinding[]): RemediationAction[] {
  const scFindings = findings.filter((f) => f.tool === "shellcheck");
  if (scFindings.length === 0) return [];

  return scFindings.map((finding) => ({
    finding,
    action: "configure" as const,
    description: finding.recommendation ?? `Shell script: ${finding.message}`,
    confidence: "medium" as const,
  }));
}

// ── Main entry point ──────────────────────────────────────────────

/** Generate a remediation plan from scan findings. */
export function generateRemediationPlan(findings: ScanFinding[]): AutoRemediationPlan {
  if (findings.length === 0) {
    return { actions: [], autoFixable: 0, manualRequired: 0, summary: "No findings to remediate." };
  }

  const actions: RemediationAction[] = [
    ...remediateNpmFindings(findings),
    ...remediatePipFindings(findings),
    ...remediateIacFindings(findings),
    ...remediateSecretFindings(findings),
    ...remediateHadolintFindings(findings),
    ...remediateShellcheckFindings(findings),
  ];

  // Catch any findings not handled by a specific remediator
  const handledIds = new Set(actions.map((a) => a.finding.id));
  const unhandled = findings.filter((f) => !handledIds.has(f.id));
  for (const finding of unhandled) {
    actions.push({
      finding,
      action: "manual",
      description: finding.recommendation ?? `Review: ${finding.message}`,
      confidence: "low",
    });
  }

  const autoFixable = actions.filter((a) => a.command && a.confidence !== "low").length;
  const manualRequired = actions.length - autoFixable;

  const summary = `${actions.length} action(s): ${autoFixable} auto-fixable, ${manualRequired} manual`;

  return { actions, autoFixable, manualRequired, summary };
}

// ── Helpers ───────────────────────────────────────────────────────

/** Extract a package name from a finding message. Looks for "name:" or "name " patterns. */
function extractPackageName(message: string): string | undefined {
  // Common patterns: "lodash: prototype pollution" or "lodash (>=4.0.0)" or "Package: lodash"
  const colonMatch = /^([a-z@][a-z0-9_./@-]*)\s*:/i.exec(message);
  if (colonMatch) return colonMatch[1];

  const packageMatch = /Package:\s*([a-z@][a-z0-9_./@-]*)/i.exec(message);
  if (packageMatch) return packageMatch[1];

  return undefined;
}
