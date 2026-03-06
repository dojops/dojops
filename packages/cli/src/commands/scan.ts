import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { runScan, planRemediation, applyFixes, compareScanReports } from "@dojops/scanner";
import type { ScanType, ScanReport, ScanFinding, RemediationPlan } from "@dojops/scanner";
import type { RepoContext } from "@dojops/core";
import * as yaml from "js-yaml";
import { CLIContext } from "../types";
import { wrapForNote } from "../formatter";
import { hasFlag, extractFlagValue } from "../parser";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import {
  findProjectRoot,
  initProject,
  appendAudit,
  loadContext,
  saveScanReport,
  listScanReports,
  dojopsDir,
  getCurrentUser,
} from "../state";
import { emitGitHubAnnotations } from "../ci-annotations";

export async function scanCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  const flags = parseScanFlags(args, ctx);
  const { root, scanRoot } = resolveScanRoot(flags.targetDir, ctx);
  const context = loadContext(root) ?? undefined;

  const report = await executeScan(scanRoot, flags.scanType, context, ctx);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(report, null, 2));
    throwOnSeverity(report, flags.failOnSeverity);
    return;
  }

  if (ctx.globalOpts.output === "yaml") {
    console.log(yaml.dump(report, { lineWidth: 120, noRefs: true }));
    throwOnSeverity(report, flags.failOnSeverity);
    return;
  }

  displayScannerStatus(report);
  displaySummary(report.summary);
  displayFindings(report.findings);

  if (report.findings.length > 0) {
    emitGitHubAnnotations(report.findings);
  }

  saveReport(root, report);

  if (flags.compareMode) {
    handleCompareMode(report, root);
  }

  handleSbomOutputs(report, root);

  appendAudit(root, {
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
    command: "scan",
    action: "scan",
    status: "success",
    durationMs: Date.now() - startTime,
  });

  let rescanReport: ScanReport | null = null;
  if (flags.fixMode && report.findings.length > 0) {
    rescanReport = await handleFixMode(
      report,
      scanRoot,
      flags.scanType,
      context,
      root,
      ctx,
      flags.autoApprove,
    );
  }

  throwOnSeverity(rescanReport ?? report, flags.failOnSeverity);
}

type SeverityThreshold = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface ScanFlags {
  scanType: ScanType;
  fixMode: boolean;
  autoApprove: boolean;
  targetDir: string | undefined;
  compareMode: boolean;
  failOnSeverity: SeverityThreshold | undefined;
}

function parseScanFlags(args: string[], ctx: CLIContext): ScanFlags {
  const securityOnly = hasFlag(args, "--security");
  const depsOnly = hasFlag(args, "--deps");
  const iacOnly = hasFlag(args, "--iac");
  const sbomMode = hasFlag(args, "--sbom");
  const licenseOnly = hasFlag(args, "--license");
  const fixMode = hasFlag(args, "--fix");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const targetDir = extractFlagValue(args, "--target");
  const compareMode = hasFlag(args, "--compare");
  const failOnArg = extractFlagValue(args, "--fail-on");
  const failOnSeverity = failOnArg?.toUpperCase() as SeverityThreshold | undefined;
  if (failOnArg && !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(failOnSeverity!)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --fail-on value: "${failOnArg}". Must be CRITICAL, HIGH, MEDIUM, or LOW.`,
    );
  }

  let scanType: ScanType = "all";
  if (securityOnly) scanType = "security";
  else if (depsOnly) scanType = "deps";
  else if (iacOnly) scanType = "iac";
  else if (sbomMode) scanType = "sbom";
  else if (licenseOnly) scanType = "license";

  return { scanType, fixMode, autoApprove, targetDir, compareMode, failOnSeverity };
}

function resolveScanRoot(
  targetDir: string | undefined,
  ctx: CLIContext,
): { root: string; scanRoot: string } {
  if (targetDir) {
    const scanRoot = path.resolve(targetDir);
    if (!fs.existsSync(scanRoot)) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Target directory not found: ${scanRoot}`);
    }
    const root = findProjectRoot() ?? scanRoot;
    return { root, scanRoot };
  }

  const root = findProjectRoot() ?? ctx.cwd;
  if (!findProjectRoot()) {
    initProject(root);
  }
  return { root, scanRoot: root };
}

async function executeScan(
  scanRoot: string,
  scanType: ScanType,
  context: RepoContext | undefined,
  ctx: CLIContext,
): Promise<ScanReport> {
  const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  const scanSpinner = p.spinner();
  if (!isStructuredOutput) scanSpinner.start(`Scanning project (${scanType})...`);

  try {
    const report = await runScan(scanRoot, scanType, context);
    if (!isStructuredOutput) scanSpinner.stop(`Scan complete in ${report.durationMs}ms`);
    return report;
  } catch (err) {
    if (!isStructuredOutput) scanSpinner.stop("Scan failed");
    throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
  }
}

function displayScannerStatus(report: ScanReport): void {
  if (report.scannersRun.length > 0) {
    p.log.info(`Scanners run: ${report.scannersRun.join(", ")}`);
  }
  if (report.scannersSkipped.length > 0) {
    p.log.warn(`Scanners skipped:\n  ${report.scannersSkipped.join("\n  ")}`);
  }

  if (report.scannersRun.length === 0) {
    displayNoScannersWarning();
  }

  if (report.scannersSkipped.length > 0) {
    displayInstallHints(report.scannersSkipped);
  }
}

function displayNoScannersWarning(): void {
  p.note(
    wrapForNote(
      [
        `${pc.bold(pc.yellow("No scanners were executed."))}`,
        "",
        "Possible reasons:",
        `  ${pc.dim("•")} Scanner binaries not installed (trivy, checkov, hadolint, etc.)`,
        `  ${pc.dim("•")} No applicable scanners for this project structure`,
        `  ${pc.dim("•")} Scanner type filter (--security, --deps, etc.) excludes all scanners`,
        "",
        `Run ${pc.cyan("dojops status")} to check which scanners are available.`,
      ].join("\n"),
    ),
    "Warning",
  );
}

const INSTALL_HINTS: Record<string, string> = {
  trivy:
    "brew install trivy | apt-get install trivy | https://trivy.dev/latest/getting-started/installation/",
  checkov: "pip install checkov | brew install checkov",
  hadolint:
    "brew install hadolint | apt-get install hadolint | https://github.com/hadolint/hadolint",
  gitleaks: "brew install gitleaks | https://github.com/gitleaks/gitleaks",
  shellcheck: "brew install shellcheck | apt-get install shellcheck",
  semgrep: "pip install semgrep | brew install semgrep",
  "trivy-sbom": "brew install trivy | apt-get install trivy",
  "trivy-license": "brew install trivy | apt-get install trivy",
};

function displayInstallHints(scannersSkipped: string[]): void {
  const hints: string[] = [];
  for (const skipped of scannersSkipped) {
    const scannerName = skipped.split(":")[0].trim();
    if (skipped.includes("not found") && INSTALL_HINTS[scannerName]) {
      hints.push(`  ${pc.cyan(scannerName)}: ${pc.dim(INSTALL_HINTS[scannerName])}`);
    }
  }

  if (hints.length > 0) {
    p.note(
      wrapForNote([`${pc.bold("Install missing scanners:")}`, "", ...hints].join("\n")),
      "Install Hints",
    );
  }
}

function displaySummary(summary: ScanReport["summary"]): void {
  if (summary.total === 0) {
    p.log.success("No security issues found.");
    return;
  }

  const parts: string[] = [];
  if (summary.critical > 0) parts.push(pc.bold(pc.red(`${summary.critical} CRITICAL`)));
  if (summary.high > 0) parts.push(pc.red(`${summary.high} HIGH`));
  if (summary.medium > 0) parts.push(pc.yellow(`${summary.medium} MEDIUM`));
  if (summary.low > 0) parts.push(pc.dim(`${summary.low} LOW`));

  p.log.warn(`Found ${summary.total} issue(s): ${parts.join(", ")}`);
}

function displayFindings(findings: ScanFinding[]): void {
  if (findings.length === 0) return;

  console.log();
  for (const finding of findings) {
    const sev = severityLabel(finding.severity);
    const fileLine = finding.line ? `:${finding.line}` : "";
    const loc = finding.file ? `${finding.file}${fileLine}` : "";
    const toolLabel = pc.dim(`[${finding.tool}]`);
    console.log(`  ${sev}  ${toolLabel} ${finding.message}` + (loc ? `  ${pc.dim(loc)}` : ""));
    if (finding.recommendation) {
      console.log(`         ${pc.dim("→")} ${pc.dim(finding.recommendation)}`);
    }
  }
  console.log();
}

function saveReport(root: string, report: ScanReport): void {
  try {
    saveScanReport(root, report as unknown as Record<string, unknown>);
    p.log.info(`Report saved: ${pc.dim(report.id)}`);
  } catch {
    // Non-fatal
  }
}

function handleCompareMode(report: ScanReport, root: string): void {
  const previousReports = listScanReports(root);
  const previous = previousReports.find((r) => r.id !== report.id) as ScanReport | undefined;

  if (!previous) {
    p.log.info("No previous scan to compare against.");
    return;
  }

  const { newFindings, resolvedFindings } = compareScanReports(report, previous);
  console.log();
  displayNewFindings(newFindings);
  displayResolvedFindings(resolvedFindings);
  if (newFindings.length === 0 && resolvedFindings.length === 0) {
    p.log.info("No changes since last scan.");
  }
  console.log();
}

function displayNewFindings(findings: ScanFinding[]): void {
  if (findings.length === 0) return;
  const newLabel = pc.bold(pc.red(`${findings.length} new`));
  p.log.warn(`${newLabel} finding(s) since last scan:`);
  for (const f of findings) {
    console.log(`  ${pc.red("+")} ${severityLabel(f.severity)}  ${f.message}`);
  }
}

function displayResolvedFindings(findings: ScanFinding[]): void {
  if (findings.length === 0) return;
  const resolvedLabel = pc.bold(pc.green(`${findings.length} resolved`));
  p.log.success(`${resolvedLabel} finding(s) since last scan:`);
  for (const f of findings) {
    console.log(`  ${pc.green("-")} ${severityLabel(f.severity)}  ${f.message}`);
  }
}

function handleSbomOutputs(report: ScanReport, root: string): void {
  if (!report.sbomOutputs || report.sbomOutputs.length === 0) return;

  const sbomDir = path.join(dojopsDir(root), "sbom");
  if (!fs.existsSync(sbomDir)) fs.mkdirSync(sbomDir, { recursive: true });

  const combinedSbom = report.sbomOutputs.join("\n");
  const currentHash = crypto.createHash("sha256").update(combinedSbom).digest("hex");

  for (const sbom of report.sbomOutputs) {
    const ts = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const sbomFilePath = path.join(sbomDir, `sbom-${ts}.json`);
    fs.writeFileSync(sbomFilePath, sbom);
    p.log.success(`SBOM saved: ${pc.dim(sbomFilePath)}`);
    report.sbomPath = sbomFilePath;
  }

  report.sbomHash = currentHash;

  compareSbomHash(report, root, currentHash);
}

function compareSbomHash(report: ScanReport, root: string, currentHash: string): void {
  const previousReports = listScanReports(root);
  const previousWithSbom = previousReports.find((r) => r.sbomHash && r.id !== report.id);
  if (!previousWithSbom) return;

  const prevHash = previousWithSbom.sbomHash as string;
  if (prevHash !== currentHash) {
    p.log.warn(
      `SBOM changed since last scan (previous: ${pc.dim(prevHash.slice(0, 12))}, ` +
        `current: ${pc.dim(currentHash.slice(0, 12))})`,
    );
  }
}

async function handleFixMode(
  report: ScanReport,
  scanRoot: string,
  scanType: ScanType,
  context: RepoContext | undefined,
  root: string,
  ctx: CLIContext,
  autoApprove: boolean,
): Promise<ScanReport | null> {
  const criticalFindings = report.findings.filter(
    (f) => f.severity === "HIGH" || f.severity === "CRITICAL",
  );

  if (criticalFindings.length === 0) {
    p.log.info("No HIGH/CRITICAL findings to fix.");
    return null;
  }

  return generateAndApplyFixes(criticalFindings, {
    report,
    scanRoot,
    scanType,
    context,
    root,
    ctx,
    autoApprove,
  });
}

interface FixContext {
  report: ScanReport;
  scanRoot: string;
  scanType: ScanType;
  context: RepoContext | undefined;
  root: string;
  ctx: CLIContext;
  autoApprove: boolean;
}

async function generateAndApplyFixes(
  criticalFindings: ScanFinding[],
  fixCtx: FixContext,
): Promise<ScanReport | null> {
  const remSpinner = p.spinner();
  remSpinner.start("Generating remediation plan...");

  try {
    const provider = fixCtx.ctx.getProvider();
    const plan = await planRemediation(criticalFindings, provider);
    remSpinner.stop("Remediation plan ready");

    if (plan.fixes.length === 0) {
      p.log.info("No automatic fixes generated.");
      return null;
    }

    return promptAndApplyFixes(plan, fixCtx);
  } catch (err) {
    remSpinner.stop("Remediation failed");
    p.log.error(toErrorMessage(err));
    return null;
  }
}

async function promptAndApplyFixes(
  plan: RemediationPlan,
  fixCtx: FixContext,
): Promise<ScanReport | null> {
  p.note(
    wrapForNote(
      plan.fixes
        .map((f) => `${pc.bold(f.findingId)}: ${f.action} ${pc.dim(f.file)}\n  ${f.description}`)
        .join("\n\n"),
    ),
    "Remediation Plan",
  );

  const approved = await getApproval(fixCtx.autoApprove, plan.fixes.length);
  if (!approved) return null;

  return applyFixesAndRescan(plan, fixCtx);
}

async function getApproval(autoApprove: boolean, fixCount: number): Promise<boolean> {
  if (autoApprove) return true;

  const confirm = await p.confirm({
    message: `Apply ${fixCount} fix(es)?`,
  });
  if (p.isCancel(confirm)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return confirm;
}

async function applyFixesAndRescan(plan: RemediationPlan, fixCtx: FixContext): Promise<ScanReport> {
  const { report, scanRoot, scanType, context, root } = fixCtx;
  for (const fix of plan.fixes) {
    const fixPath = path.resolve(root, fix.file);
    if (fs.existsSync(fixPath)) {
      fs.copyFileSync(fixPath, fixPath + ".bak");
    }
  }
  const patchResult = applyFixes(plan, root);
  if (patchResult.filesModified.length > 0) {
    p.log.success(`Modified: ${patchResult.filesModified.join(", ")}`);
  }
  if (patchResult.errors.length > 0) {
    for (const e of patchResult.errors) {
      p.log.warn(e);
    }
  }

  p.log.step("Re-scanning to verify fixes...");
  const rescanReport = await runScan(scanRoot, scanType, context);
  const delta = report.summary.total - rescanReport.summary.total;
  if (delta > 0) {
    p.log.success(`Fixed ${delta} issue(s) (${rescanReport.summary.total} remaining)`);
  } else {
    p.log.info(`${rescanReport.summary.total} issue(s) remaining`);
  }

  return rescanReport;
}

function severityLabel(severity: ScanFinding["severity"]): string {
  switch (severity) {
    case "CRITICAL":
      return pc.bold(pc.red("CRIT"));
    case "HIGH":
      return pc.red("HIGH");
    case "MEDIUM":
      return pc.yellow("MED ");
    case "LOW":
      return pc.dim("LOW ");
  }
}

function throwOnSeverity(
  report: ScanReport,
  threshold: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = "HIGH",
): void {
  // SBOM scans always pass (no findings to assess)
  if (report.scanType === "sbom") {
    return;
  }
  const severity = threshold;
  const levels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const minIndex = levels.indexOf(severity);
  for (let i = levels.length - 1; i >= minIndex; i--) {
    const key = levels[i].toLowerCase() as keyof typeof report.summary;
    if ((report.summary[key] as number) > 0) {
      if (i >= levels.indexOf("CRITICAL")) {
        throw new CLIError(ExitCode.CRITICAL_VULNERABILITIES);
      }
      throw new CLIError(ExitCode.SECURITY_ISSUES);
    }
  }
}
