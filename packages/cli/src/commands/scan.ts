import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { runScan, planRemediation, applyFixes, compareScanReports } from "@dojops/scanner";
import type { ScanType, ScanReport, ScanFinding } from "@dojops/scanner";
import * as yaml from "js-yaml";
import { CLIContext } from "../types";
import { wrapForNote } from "../formatter";
import { hasFlag, extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
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

  // Parse flags
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
  const failOnSeverity = failOnArg?.toUpperCase() as
    | "CRITICAL"
    | "HIGH"
    | "MEDIUM"
    | "LOW"
    | undefined;
  if (failOnArg && !["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(failOnSeverity!)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --fail-on value: "${failOnArg}". Must be CRITICAL, HIGH, MEDIUM, or LOW.`,
    );
  }

  // Determine scan type
  let scanType: ScanType = "all";
  if (securityOnly) scanType = "security";
  else if (depsOnly) scanType = "deps";
  else if (iacOnly) scanType = "iac";
  else if (sbomMode) scanType = "sbom";
  else if (licenseOnly) scanType = "license";

  // Find or init project (use --target if specified)
  let root: string;
  let scanRoot: string;
  if (targetDir) {
    scanRoot = path.resolve(targetDir);
    if (!fs.existsSync(scanRoot)) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Target directory not found: ${scanRoot}`);
    }
    // Use project root for context/audit; fall back to target dir
    root = findProjectRoot() ?? scanRoot;
  } else {
    root = findProjectRoot() ?? ctx.cwd;
    scanRoot = root;
    if (!findProjectRoot()) {
      initProject(root);
    }
  }

  // Load repo context from project root (not scan target)
  const context = loadContext(root) ?? undefined;

  // Run scan
  const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  const scanSpinner = p.spinner();
  if (!isStructuredOutput) scanSpinner.start(`Scanning project (${scanType})...`);

  let report: ScanReport;
  try {
    report = await runScan(scanRoot, scanType, context);
  } catch (err) {
    if (!isStructuredOutput) scanSpinner.stop("Scan failed");
    throw new CLIError(ExitCode.GENERAL_ERROR, err instanceof Error ? err.message : String(err));
  }

  if (!isStructuredOutput) scanSpinner.stop(`Scan complete in ${report.durationMs}ms`);

  // JSON output mode
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(report, null, 2));
    throwOnSeverity(report, failOnSeverity);
    return;
  }

  // YAML output mode
  if (ctx.globalOpts.output === "yaml") {
    console.log(yaml.dump(report, { lineWidth: 120, noRefs: true }));
    throwOnSeverity(report, failOnSeverity);
    return;
  }

  // Display scanner status
  if (report.scannersRun.length > 0) {
    p.log.info(`Scanners run: ${report.scannersRun.join(", ")}`);
  }
  if (report.scannersSkipped.length > 0) {
    p.log.warn(`Scanners skipped:\n  ${report.scannersSkipped.join("\n  ")}`);
  }

  // UX #9: Prominent warning when no scanners ran at all
  if (report.scannersRun.length === 0) {
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

  // FEAT #6: Show install hints for scanners skipped due to missing binaries
  if (report.scannersSkipped.length > 0) {
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

    const hints: string[] = [];
    for (const skipped of report.scannersSkipped) {
      // Extract scanner name from "tool: reason" format
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

  // Emit GitHub Actions annotations when running in CI
  if (report.findings.length > 0) {
    emitGitHubAnnotations(report.findings);
  }

  // Save scan report
  try {
    saveScanReport(root, report as unknown as Record<string, unknown>);
    p.log.info(`Report saved: ${pc.dim(report.id)}`);
  } catch {
    // Non-fatal
  }

  // --compare: show delta against previous scan
  if (compareMode) {
    const previousReports = listScanReports(root);
    const previous = previousReports.find(
      (r) => (r as Record<string, unknown>).id !== report.id,
    ) as ScanReport | undefined;

    if (previous) {
      const { newFindings, resolvedFindings } = compareScanReports(report, previous);
      console.log();
      if (newFindings.length > 0) {
        p.log.warn(`${pc.bold(pc.red(`${newFindings.length} new`))} finding(s) since last scan:`);
        for (const f of newFindings) {
          console.log(`  ${pc.red("+")} ${severityLabel(f.severity)}  ${f.message}`);
        }
      }
      if (resolvedFindings.length > 0) {
        p.log.success(
          `${pc.bold(pc.green(`${resolvedFindings.length} resolved`))} finding(s) since last scan:`,
        );
        for (const f of resolvedFindings) {
          console.log(`  ${pc.green("-")} ${severityLabel(f.severity)}  ${f.message}`);
        }
      }
      if (newFindings.length === 0 && resolvedFindings.length === 0) {
        p.log.info("No changes since last scan.");
      }
      console.log();
    } else {
      p.log.info("No previous scan to compare against.");
    }
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
    user: getCurrentUser(),
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
            wrapForNote(
              plan.fixes
                .map(
                  (f) =>
                    `${pc.bold(f.findingId)}: ${f.action} ${pc.dim(f.file)}\n  ${f.description}`,
                )
                .join("\n\n"),
            ),
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
            // Create .bak backups before patching
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

            // Re-run scan to show delta
            p.log.step("Re-scanning to verify fixes...");
            rescanReport = await runScan(scanRoot, scanType, context);
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

  throwOnSeverity(rescanReport ?? report, failOnSeverity);
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
  threshold?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
): void {
  // SBOM scans always pass (no findings to assess)
  if (report.scanType === "sbom") {
    return;
  }
  const severity = threshold ?? "HIGH"; // default: fail on HIGH+
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
