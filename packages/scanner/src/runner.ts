import * as crypto from "node:crypto";
import type { RepoContext } from "@dojops/core";
import { ScanType, ScanReport, ScannerResult, ScanFinding } from "./types";
import { scanNpm } from "./scanners/npm";
import { scanPip } from "./scanners/pip";
import { scanTrivy } from "./scanners/trivy";
import { scanCheckov } from "./scanners/checkov";
import { scanHadolint } from "./scanners/hadolint";
import { scanGitleaks } from "./scanners/gitleaks";
import { scanShellcheck } from "./scanners/shellcheck";
import { scanTrivySbom } from "./scanners/trivy-sbom";
import { scanTrivyLicense } from "./scanners/trivy-license";
import { scanSemgrep } from "./scanners/semgrep";
import { loadScanPolicy, evaluatePolicy } from "./scan-policy";
import type { ScanBaseline } from "./baseline";
import { filterBaselined } from "./baseline";

interface ScannerEntry {
  name: string;
  fn: (projectPath: string) => Promise<ScannerResult>;
  categories: Array<"deps" | "security" | "iac" | "sbom" | "license">;
  /** Check if this scanner is applicable given the repo context */
  applicable: (ctx?: RepoContext) => boolean;
}

const SCANNERS: ScannerEntry[] = [
  {
    name: "npm-audit",
    fn: scanNpm,
    categories: ["deps", "security"],
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
    categories: ["deps", "security"],
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
    categories: ["iac", "security"],
    applicable: (ctx) =>
      !ctx ||
      ctx.infra.hasTerraform ||
      ctx.infra.hasKubernetes ||
      ctx.infra.hasHelm ||
      ctx.infra.hasAnsible ||
      ctx.infra.hasCloudFormation ||
      ctx.infra.hasKustomize ||
      ctx.infra.hasPacker ||
      ctx.infra.hasPulumi ||
      ctx.container.hasDockerfile,
  },
  {
    name: "hadolint",
    fn: scanHadolint,
    categories: ["iac", "security"],
    applicable: (ctx) => !ctx || ctx.container.hasDockerfile,
  },
  {
    name: "shellcheck",
    fn: scanShellcheck,
    categories: ["iac", "security"],
    applicable: (ctx) => !ctx || (ctx.scripts?.shellScripts?.length ?? 0) > 0,
  },
  {
    name: "trivy-sbom",
    fn: scanTrivySbom,
    categories: ["sbom"],
    applicable: () => true,
  },
  {
    name: "trivy-license",
    fn: scanTrivyLicense,
    categories: ["license"],
    applicable: () => true,
  },
  {
    name: "semgrep",
    fn: scanSemgrep,
    categories: ["security"],
    applicable: () => true, // Semgrep auto-detects languages
  },
];

function collectResults(
  settled: PromiseSettledResult<ScannerResult>[],
  selected: typeof SCANNERS,
): { results: ScannerResult[]; errors: string[] } {
  const results: ScannerResult[] = [];
  const errors: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
      continue;
    }
    const reason =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    const isTimeout = reason.startsWith("timeout after");
    const skipReason = isTimeout ? `Scanner timed out: ${reason}` : `Scanner crashed: ${reason}`;
    errors.push(`${selected[i].name}: ${skipReason}`);
    results.push({ tool: selected[i].name, findings: [], skipped: true, skipReason });
  }
  return { results, errors };
}

export async function runScan(
  projectPath: string,
  scanType: ScanType,
  context?: RepoContext,
  options?: { baseline?: ScanBaseline },
): Promise<ScanReport> {
  const startTime = Date.now();

  // Select applicable scanners
  const selected = SCANNERS.filter((s) => {
    // Filter by scan type
    if (scanType !== "all" && !s.categories.includes(scanType)) {
      return false;
    }
    // Filter by project context
    return s.applicable(context);
  });

  // FEAT #5: Per-scanner timeout (default from env or 60s)
  const scannerTimeoutMs = Number.parseInt(process.env.DOJOPS_SCAN_TIMEOUT_MS ?? "60000", 10);

  function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      promise.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  // Run all selected scanners concurrently (allSettled to avoid one failure killing the scan)
  const settled = await Promise.allSettled(
    selected.map((s) => withTimeout(s.fn(projectPath), scannerTimeoutMs)),
  );
  const { results, errors } = collectResults(settled, selected);

  // Collect findings and track scanner status
  const allFindings: ScanFinding[] = [];
  const scannersRun: string[] = [];
  const scannersSkipped: string[] = [];
  const sbomOutputs: string[] = [];

  for (const result of results) {
    if (result.skipped) {
      scannersSkipped.push(`${result.tool}: ${result.skipReason}`);
    } else {
      scannersRun.push(result.tool);
      allFindings.push(...result.findings);
      if (result.sbomOutput) {
        sbomOutputs.push(result.sbomOutput);
      }
    }
  }

  // Deduplicate findings that share the same CVE
  const dedupedFindings = deduplicateByCve(allFindings);

  // Apply baseline filtering if provided
  let finalFindings = dedupedFindings;
  let baselineApplied = false;
  let baselineFilteredCount = 0;
  if (options?.baseline) {
    const originalCount = dedupedFindings.length;
    // Map ScanFinding[] to the shape filterBaselined expects
    const mapped = dedupedFindings.map((f) => ({
      ...f,
      scanner: f.tool,
      ruleId: f.cve ?? f.id,
    }));
    const filtered = filterBaselined(mapped, options.baseline);
    // Recover original ScanFinding objects by matching
    const filteredSet = new Set(filtered.map((f) => f.id as string));
    finalFindings = dedupedFindings.filter((f) => filteredSet.has(f.id));
    baselineApplied = true;
    baselineFilteredCount = originalCount - finalFindings.length;
  }

  // Recompute summary after deduplication and baseline filtering
  const dedupedSummary = {
    total: finalFindings.length,
    critical: finalFindings.filter((f) => f.severity === "CRITICAL").length,
    high: finalFindings.filter((f) => f.severity === "HIGH").length,
    medium: finalFindings.filter((f) => f.severity === "MEDIUM").length,
    low: finalFindings.filter((f) => f.severity === "LOW").length,
  };

  const report: ScanReport = {
    id: `scan-${crypto.randomUUID().slice(0, 8)}`,
    projectPath,
    timestamp: new Date().toISOString(),
    scanType,
    findings: finalFindings,
    summary: dedupedSummary,
    scannersRun,
    scannersSkipped,
    durationMs: Date.now() - startTime,
    ...(sbomOutputs.length > 0 ? { sbomOutputs } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(baselineApplied ? { baselineApplied, baselineFilteredCount } : {}),
  };

  // Evaluate scan policy if present
  const policy = loadScanPolicy(projectPath);
  if (policy) {
    report.policyResult = evaluatePolicy(report, policy);
  }

  return report;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Deduplicate findings that share the same CVE identifier.
 * For duplicates, keeps the finding with the highest severity.
 * Findings without a `cve` field are always kept.
 */
export function deduplicateByCve(findings: ScanFinding[]): ScanFinding[] {
  const noCve: ScanFinding[] = [];
  const byCve = new Map<string, ScanFinding>();

  for (const f of findings) {
    if (!f.cve) {
      noCve.push(f);
      continue;
    }
    const existing = byCve.get(f.cve);
    if (existing) {
      // Keep the one with the higher severity
      if ((SEVERITY_RANK[f.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
        byCve.set(f.cve, f);
      }
    } else {
      byCve.set(f.cve, f);
    }
  }

  return [...noCve, ...byCve.values()];
}

/**
 * Compare two scan reports and identify new and resolved findings.
 * Comparison is done by finding `id` field.
 */
export function compareScanReports(
  current: ScanReport,
  previous: ScanReport,
): { newFindings: ScanFinding[]; resolvedFindings: ScanFinding[] } {
  const previousIds = new Set(previous.findings.map((f) => f.id));
  const currentIds = new Set(current.findings.map((f) => f.id));

  const newFindings = current.findings.filter((f) => !previousIds.has(f.id));
  const resolvedFindings = previous.findings.filter((f) => !currentIds.has(f.id));

  return { newFindings, resolvedFindings };
}
