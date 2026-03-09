import pc from "picocolors";
import * as p from "@clack/prompts";
import { runReviewPipeline } from "@dojops/api";
import type { ReviewPipelineResult } from "@dojops/api";
import type { ToolValidationResult } from "@dojops/core";
import { CLIContext } from "../types";
import { wrapForNote } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";

/**
 * dojops review [files...] [--auto-discover] [--context7]
 *
 * Runs the full DevSecOps review pipeline:
 * 1. Discover or accept DevOps config files
 * 2. Run validation tools (actionlint, hadolint, shellcheck, etc.)
 * 3. Feed tool results + file contents to LLM for structured analysis
 * 4. Display severity-ranked findings with maturity score
 */
export async function reviewCommand(args: string[], ctx: CLIContext): Promise<void> {
  const provider = ctx.getProvider();
  const projectRoot = ctx.cwd;

  // Parse flags
  const noAutoDiscover = args.includes("--no-auto-discover");
  const useContext7 = args.includes("--context7") || process.env.DOJOPS_CONTEXT_ENABLED === "true";

  // Explicit file paths (positional args that aren't flags)
  const explicitFiles = args.filter((a) => !a.startsWith("-")).map((f) => ({ path: f }));

  if (explicitFiles.length === 0 && noAutoDiscover) {
    p.log.info(`  ${pc.dim("$")} dojops review`);
    p.log.info(`  ${pc.dim("$")} dojops review .github/workflows/ci.yml Dockerfile`);
    p.log.info(`  ${pc.dim("$")} dojops review --no-auto-discover file1.yml file2.yml`);
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No files provided and auto-discovery is disabled.",
    );
  }

  const isStructured = ctx.globalOpts.output !== "table";
  const s = p.spinner();

  // Step 1: Discover files
  if (!isStructured) {
    if (explicitFiles.length > 0) {
      s.start(`Reviewing ${explicitFiles.length} file(s)...`);
    } else {
      s.start("Discovering DevOps config files...");
    }
  }

  let result: ReviewPipelineResult;
  try {
    result = await runReviewPipeline({
      provider,
      projectRoot,
      files: explicitFiles.length > 0 ? explicitFiles : undefined,
      autoDiscover: !noAutoDiscover,
      useContext7,
    });
  } catch (err) {
    if (!isStructured) s.stop("Review failed.");
    throw err;
  }

  if (!isStructured) s.stop("Review complete.");

  // JSON output mode
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Pretty-print the review report
  const output = formatReviewReport(result);
  p.note(wrapForNote(output), "DevSecOps Review");
}

/** Format the full review report for terminal display. */
function formatReviewReport(result: ReviewPipelineResult): string {
  const { report, toolResults, filesReviewed } = result;
  const lines: string[] = [];

  // Header: score + summary
  lines.push(`${pc.bold("Score:")}   ${scoreColor(report.score)} / 100`);
  lines.push(`${pc.bold("Summary:")} ${report.summary}`);
  lines.push("");

  // Files reviewed
  lines.push(pc.bold(`Files Reviewed (${filesReviewed.length}):`));
  for (const f of filesReviewed) {
    lines.push(`  ${pc.dim("-")} ${pc.underline(f)}`);
  }
  lines.push("");

  // Tool execution summary
  const toolsSummary = summarizeToolResults(toolResults);
  if (toolsSummary.length > 0) {
    lines.push(pc.bold("Tool Results:"));
    for (const line of toolsSummary) {
      lines.push(`  ${line}`);
    }
    lines.push("");
  }

  // Findings by severity
  if (report.findings.length > 0) {
    lines.push(pc.bold(`Findings (${report.findings.length}):`));
    lines.push("");

    // Sort by severity: critical > high > medium > low > info
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sorted = [...report.findings].sort(
      (a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5),
    );

    for (const finding of sorted) {
      const sev = severityBadge(finding.severity);
      const cat = pc.dim(`[${finding.category}]`);
      const tool = finding.toolSource ? pc.dim(` (${finding.toolSource})`) : "";
      const lineInfo = finding.line ? pc.dim(`:${finding.line}`) : "";

      lines.push(`  ${sev} ${cat} ${pc.underline(finding.file)}${lineInfo}${tool}`);
      lines.push(`    ${finding.message}`);
      lines.push(`    ${pc.cyan("Fix:")} ${finding.recommendation}`);
      lines.push("");
    }
  } else {
    lines.push(pc.green("No issues found."));
    lines.push("");
  }

  // Recommended actions
  if (report.recommendedActions.length > 0) {
    lines.push(pc.bold("Recommended Actions:"));
    for (let i = 0; i < report.recommendedActions.length; i++) {
      lines.push(`  ${pc.cyan(`${i + 1}.`)} ${report.recommendedActions[i]}`);
    }
  }

  return lines.join("\n");
}

/** Summarize tool execution results. */
function summarizeToolResults(results: ToolValidationResult[]): string[] {
  const lines: string[] = [];
  // Group by tool
  const byTool = new Map<string, { passed: number; failed: number; skipped: number }>();
  for (const r of results) {
    const key = r.tool;
    const entry = byTool.get(key) ?? { passed: 0, failed: 0, skipped: 0 };
    const isSkipped = r.issues.length === 1 && r.issues[0].severity === "info";
    if (isSkipped) {
      entry.skipped++;
    } else if (r.passed) {
      entry.passed++;
    } else {
      entry.failed++;
    }
    byTool.set(key, entry);
  }

  for (const [tool, counts] of byTool) {
    const parts: string[] = [];
    if (counts.passed > 0) parts.push(pc.green(`${counts.passed} passed`));
    if (counts.failed > 0) parts.push(pc.red(`${counts.failed} failed`));
    if (counts.skipped > 0) parts.push(pc.dim(`${counts.skipped} skipped`));
    lines.push(`${pc.bold(tool)}: ${parts.join(", ")}`);
  }

  return lines;
}

/** Color a severity badge for terminal display. */
function severityBadge(severity: string): string {
  switch (severity) {
    case "critical":
      return pc.bgRed(pc.white(pc.bold(" CRITICAL ")));
    case "high":
      return pc.red(pc.bold("[HIGH]"));
    case "medium":
      return pc.yellow("[MEDIUM]");
    case "low":
      return pc.blue("[LOW]");
    case "info":
      return pc.dim("[INFO]");
    default:
      return pc.dim(`[${severity}]`);
  }
}

/** Color-code the maturity score. */
function scoreColor(score: number): string {
  if (score >= 76) return pc.green(pc.bold(String(score)));
  if (score >= 51) return pc.yellow(pc.bold(String(score)));
  if (score >= 26) return pc.magenta(pc.bold(String(score)));
  return pc.red(pc.bold(String(score)));
}
