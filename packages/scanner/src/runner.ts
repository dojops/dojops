import * as crypto from "node:crypto";
import type { RepoContext } from "@dojops/core";
import { ScanType, ScanReport, ScannerResult, ScanFinding } from "./types";
import { scanNpm } from "./scanners/npm";
import { scanPip } from "./scanners/pip";
import { scanTrivy } from "./scanners/trivy";
import { scanCheckov } from "./scanners/checkov";
import { scanHadolint } from "./scanners/hadolint";
import { scanGitleaks } from "./scanners/gitleaks";

interface ScannerEntry {
  name: string;
  fn: (projectPath: string) => Promise<ScannerResult>;
  categories: Array<"deps" | "security" | "iac">;
  /** Check if this scanner is applicable given the repo context */
  applicable: (ctx?: RepoContext) => boolean;
}

const SCANNERS: ScannerEntry[] = [
  {
    name: "npm-audit",
    fn: scanNpm,
    categories: ["deps"],
    applicable: (ctx) =>
      !ctx ||
      ctx.primaryLanguage === "Node.js" ||
      ctx.primaryLanguage === "node" ||
      ctx.packageManager?.name === "npm" ||
      ctx.languages?.some((l) => l.name === "node" || l.name === "Node.js") ||
      false,
  },
  {
    name: "pip-audit",
    fn: scanPip,
    categories: ["deps"],
    applicable: (ctx) =>
      !ctx ||
      ctx.primaryLanguage === "Python" ||
      ctx.primaryLanguage === "python" ||
      ctx.languages?.some((l) => l.name === "python" || l.name === "Python") ||
      false,
  },
  {
    name: "trivy",
    fn: scanTrivy,
    categories: ["security"],
    applicable: () => true, // trivy scans everything
  },
  {
    name: "gitleaks",
    fn: scanGitleaks,
    categories: ["security"],
    applicable: () => true, // always applicable
  },
  {
    name: "checkov",
    fn: scanCheckov,
    categories: ["iac"],
    applicable: (ctx) =>
      !ctx ||
      ctx.infra.hasTerraform ||
      ctx.infra.hasKubernetes ||
      ctx.infra.hasHelm ||
      ctx.infra.hasAnsible,
  },
  {
    name: "hadolint",
    fn: scanHadolint,
    categories: ["iac", "security"],
    applicable: (ctx) => !ctx || ctx.container.hasDockerfile,
  },
];

export async function runScan(
  projectPath: string,
  scanType: ScanType,
  context?: RepoContext,
): Promise<ScanReport> {
  const startTime = Date.now();

  // Select applicable scanners
  const selected = SCANNERS.filter((s) => {
    // Filter by scan type
    if (scanType !== "all" && !s.categories.includes(scanType as "deps" | "security" | "iac")) {
      return false;
    }
    // Filter by project context
    return s.applicable(context);
  });

  // Run all selected scanners concurrently
  const results = await Promise.all(selected.map((s) => s.fn(projectPath)));

  // Collect findings and track scanner status
  const allFindings: ScanFinding[] = [];
  const scannersRun: string[] = [];
  const scannersSkipped: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.skipped) {
      scannersSkipped.push(`${result.tool}: ${result.skipReason}`);
    } else {
      scannersRun.push(result.tool);
      allFindings.push(...result.findings);
    }
  }

  // Compute summary
  const summary = {
    total: allFindings.length,
    critical: allFindings.filter((f) => f.severity === "CRITICAL").length,
    high: allFindings.filter((f) => f.severity === "HIGH").length,
    medium: allFindings.filter((f) => f.severity === "MEDIUM").length,
    low: allFindings.filter((f) => f.severity === "LOW").length,
  };

  return {
    id: `scan-${crypto.randomUUID().slice(0, 8)}`,
    projectPath,
    timestamp: new Date().toISOString(),
    scanType,
    findings: allFindings,
    summary,
    scannersRun,
    scannersSkipped,
    durationMs: Date.now() - startTime,
  };
}
