import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { runScan, planRemediation, applyFixes } from "@dojops/scanner";
import type { ScanType, ScanReport, ScanFinding } from "@dojops/scanner";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import { ExitCode } from "../exit-codes";
import {
  findProjectRoot,
  initProject,
  appendAudit,
  loadContext,
  saveScanReport,
  listScanReports,
  dojopsDir,
} from "../state";

export async function scanCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  // Parse flags
  const securityOnly = hasFlag(args, "--security");
  const depsOnly = hasFlag(args, "--deps");
  const iacOnly = hasFlag(args, "--iac");
  const sbomMode = hasFlag(args, "--sbom");
  const fixMode = hasFlag(args, "--fix");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;

  // Determine scan type
  let scanType: ScanType = "all";
  if (securityOnly) scanType = "security";
  else if (depsOnly) scanType = "deps";
  else if (iacOnly) scanType = "iac";
  else if (sbomMode) scanType = "sbom";

  // Find or init project
  let root = findProjectRoot();
  if (!root) {
    root = ctx.cwd;
    initProject(root);
  }

  // Load repo context if available
  const context = loadContext(root) ?? undefined;

  // Run scan
  const scanSpinner = p.spinner();
  scanSpinner.start(`Scanning project (${scanType})...`);

  let report: ScanReport;
  try {
    report = await runScan(root, scanType, context);
  } catch (err) {
    scanSpinner.stop("Scan failed");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(ExitCode.GENERAL_ERROR);
  }

  scanSpinner.stop(`Scan complete in ${report.durationMs}ms`);

  // JSON output mode
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(report, null, 2));
    exitWithCode(report);
    return;
  }

  // Display scanner status
  if (report.scannersRun.length > 0) {
    p.log.info(`Scanners run: ${report.scannersRun.join(", ")}`);
  }
  if (report.scannersSkipped.length > 0) {
    p.log.warn(`Scanners skipped:\n  ${report.scannersSkipped.join("\n  ")}`);
  }

  // Display summary
  const { summary } = report;
  if (summary.total === 0) {
    p.log.success("No security issues found.");
  } else {
    const parts: string[] = [];
    if (summary.critical > 0) parts.push(pc.bold(pc.red(`${summary.critical} CRITICAL`)));
    if (summary.high > 0) parts.push(pc.red(`${summary.high} HIGH`));
    if (summary.medium > 0) parts.push(pc.yellow(`${summary.medium} MEDIUM`));
    if (summary.low > 0) parts.push(pc.dim(`${summary.low} LOW`));

    p.log.warn(`Found ${summary.total} issue(s): ${parts.join(", ")}`);
  }

  // Display findings table
  if (report.findings.length > 0) {
    console.log();
    for (const finding of report.findings) {
      const sev = severityLabel(finding.severity);
      const loc = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
      console.log(
        `  ${sev}  ${pc.dim(`[${finding.tool}]`)} ${finding.message}` +
          (loc ? `  ${pc.dim(loc)}` : ""),
      );
      if (finding.recommendation) {
        console.log(`         ${pc.dim("→")} ${pc.dim(finding.recommendation)}`);
      }
    }
    console.log();
  }

  // Save scan report
  try {
    saveScanReport(root, report as unknown as Record<string, unknown>);
    p.log.info(`Report saved: ${pc.dim(report.id)}`);
  } catch {
    // Non-fatal
  }

  // Save SBOM outputs with hash tracking
  if (report.sbomOutputs && report.sbomOutputs.length > 0) {
    const sbomDir = path.join(dojopsDir(root), "sbom");
    if (!fs.existsSync(sbomDir)) fs.mkdirSync(sbomDir, { recursive: true });

    const combinedSbom = report.sbomOutputs.join("\n");
    const currentHash = crypto.createHash("sha256").update(combinedSbom).digest("hex");

    for (const sbom of report.sbomOutputs) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const sbomFilePath = path.join(sbomDir, `sbom-${ts}.json`);
      fs.writeFileSync(sbomFilePath, sbom);
      p.log.success(`SBOM saved: ${pc.dim(sbomFilePath)}`);
      report.sbomPath = sbomFilePath;
    }

    report.sbomHash = currentHash;

    // Compare with previous scan's SBOM hash
    const previousReports = listScanReports(root);
    const previousWithSbom = previousReports.find(
      (r) =>
        (r as Record<string, unknown>).sbomHash && (r as Record<string, unknown>).id !== report.id,
    );
    if (previousWithSbom) {
      const prevHash = (previousWithSbom as Record<string, unknown>).sbomHash as string;
      if (prevHash !== currentHash) {
        p.log.warn(
          `SBOM changed since last scan (previous: ${pc.dim(prevHash.slice(0, 12))}, ` +
            `current: ${pc.dim(currentHash.slice(0, 12))})`,
        );
      }
    }
  }

  // Audit log
  appendAudit(root, {
    timestamp: new Date().toISOString(),
    user: process.env.USER ?? "unknown",
    command: "scan",
    action: "scan",
    status: "success",
    durationMs: Date.now() - startTime,
  });

  // Fix mode
  let rescanReport: ScanReport | null = null;
  if (fixMode && report.findings.length > 0) {
    const criticalFindings = report.findings.filter(
      (f) => f.severity === "HIGH" || f.severity === "CRITICAL",
    );

    if (criticalFindings.length === 0) {
      p.log.info("No HIGH/CRITICAL findings to fix.");
    } else {
      const remSpinner = p.spinner();
      remSpinner.start("Generating remediation plan...");

      try {
        const provider = ctx.getProvider();
        const plan = await planRemediation(criticalFindings, provider);
        remSpinner.stop("Remediation plan ready");

        if (plan.fixes.length === 0) {
          p.log.info("No automatic fixes generated.");
        } else {
          // Show plan
          p.note(
            plan.fixes
              .map(
                (f) => `${pc.bold(f.findingId)}: ${f.action} ${pc.dim(f.file)}\n  ${f.description}`,
              )
              .join("\n\n"),
            "Remediation Plan",
          );

          // Require approval
          let approved = autoApprove;
          if (!approved) {
            const confirm = await p.confirm({
              message: `Apply ${plan.fixes.length} fix(es)?`,
            });
            if (p.isCancel(confirm)) {
              p.cancel("Cancelled.");
              process.exit(0);
            }
            approved = confirm;
          }

          if (approved) {
            const patchResult = applyFixes(plan, root);
            if (patchResult.filesModified.length > 0) {
              p.log.success(`Modified: ${patchResult.filesModified.join(", ")}`);
            }
            if (patchResult.errors.length > 0) {
              for (const e of patchResult.errors) {
                p.log.warn(e);
              }
            }

            // Re-run scan to show delta
            p.log.step("Re-scanning to verify fixes...");
            rescanReport = await runScan(root, scanType, context);
            const delta = report.summary.total - rescanReport.summary.total;
            if (delta > 0) {
              p.log.success(`Fixed ${delta} issue(s) (${rescanReport.summary.total} remaining)`);
            } else {
              p.log.info(`${rescanReport.summary.total} issue(s) remaining`);
            }
          }
        }
      } catch (err) {
        remSpinner.stop("Remediation failed");
        p.log.error(err instanceof Error ? err.message : String(err));
      }
    }
  }

  exitWithCode(rescanReport ?? report);
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

function exitWithCode(report: ScanReport): never {
  // SBOM scans always exit 0 (no findings to assess)
  if (report.scanType === "sbom") {
    process.exit(ExitCode.SUCCESS);
  }
  if (report.summary.critical > 0) {
    process.exit(ExitCode.CRITICAL_VULNERABILITIES);
  }
  if (report.summary.high > 0) {
    process.exit(ExitCode.SECURITY_ISSUES);
  }
  process.exit(ExitCode.SUCCESS);
}
