import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDiffAnalyzer, classifyDiffRisk } from "@dojops/api";
import type { DiffRiskReport, FileRiskScore } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, riskColor, changeColor, wrapForNote } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { readStdin } from "../stdin";

/** Known CLI flags that can appear in analyze diff args. */
const ANALYZE_FLAGS = new Set([
  "--non-interactive",
  "--quiet",
  "--verbose",
  "--debug",
  "--no-color",
  "--output",
  "--risk",
]);

/** Resolve diff content from --diff-file, stdin, or positional args. */
function resolveDiffContent(args: string[]): string | undefined {
  // Use --diff-file instead of --file (which is a global option for prompt input)
  const filePath = extractFlagValue(args, "--diff-file") ?? extractFlagValue(args, "--file");
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Cannot read file: ${filePath}`);
    }
  }
  const stdinContent = readStdin();
  if (stdinContent?.trim()) return stdinContent;
  // Filter only known flags — diff content legitimately starts with "-" / "---"
  const positional = args.filter((a) => {
    if (!a.startsWith("-")) return true;
    return !ANALYZE_FLAGS.has(a) && !a.startsWith("--output=");
  });
  return positional.join(" ") || undefined;
}

/** Format diff analysis into display lines. */
function formatAnalysis(analysis: {
  summary: string;
  riskLevel: string;
  costImpact: { direction: string; details: string };
  rollbackComplexity: string;
  confidence: number;
  changes: Array<{ action: string; resource: string; attribute?: string }>;
  riskFactors: string[];
  securityImpact: string[];
  recommendations: string[];
}): string[] {
  const lines = [
    `${pc.bold("Summary:")}     ${analysis.summary}`,
    `${pc.bold("Risk Level:")}  ${riskColor(analysis.riskLevel)}`,
    `${pc.bold("Cost Impact:")} ${analysis.costImpact.direction} — ${analysis.costImpact.details}`,
    `${pc.bold("Rollback:")}    ${analysis.rollbackComplexity}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(analysis.confidence)}`,
  ];

  if (analysis.changes.length > 0) {
    lines.push("", pc.bold(`Changes (${analysis.changes.length}):`));
    for (const change of analysis.changes) {
      const detail = change.attribute ? pc.dim(` (${change.attribute})`) : "";
      lines.push(`  ${changeColor(change.action.toUpperCase())} ${change.resource}${detail}`);
    }
  }

  const sections: Array<{ items: string[]; title: string; color: (s: string) => string }> = [
    { items: analysis.riskFactors, title: "Risk Factors:", color: pc.yellow },
    { items: analysis.securityImpact, title: "Security Impact:", color: pc.red },
    { items: analysis.recommendations, title: "Recommendations:", color: pc.blue },
  ];
  for (const { items, title, color } of sections) {
    if (items.length > 0) {
      lines.push("", pc.bold(title));
      for (const item of items) lines.push(`  ${color("-")} ${item}`);
    }
  }

  return lines;
}

// ── Risk classification display ───────────────────────────────────

function riskLevelLabel(level: string): string {
  switch (level) {
    case "CRITICAL":
      return pc.bold(pc.red(level));
    case "HIGH":
      return pc.red(level);
    case "MEDIUM":
      return pc.yellow(level);
    case "LOW":
      return pc.dim(level);
    default:
      return pc.dim(level);
  }
}

function changeTypeLabel(changeType: FileRiskScore["changeType"]): string {
  switch (changeType) {
    case "added":
      return pc.green("ADD");
    case "modified":
      return pc.yellow("MOD");
    case "deleted":
      return pc.red("DEL");
    case "renamed":
      return pc.blue("REN");
  }
}

function formatRiskReport(report: DiffRiskReport): string[] {
  const lines: string[] = [];

  lines.push(`${pc.bold("Overall Risk:")} ${riskLevelLabel(report.overallRisk)}`);
  lines.push(`${pc.bold("Summary:")}      ${report.summary}`);
  lines.push("");

  if (report.files.length > 0) {
    lines.push(pc.bold("Files:"));
    // Sort by risk: CRITICAL first
    const sorted = [...report.files].sort((a, b) => {
      const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
      return order.indexOf(a.risk) - order.indexOf(b.risk);
    });

    for (const file of sorted) {
      const risk = riskLevelLabel(file.risk);
      const change = changeTypeLabel(file.changeType);
      const lineCount = pc.dim(`(${file.linesChanged} lines)`);
      lines.push(`  ${risk}  ${change}  ${file.path} ${lineCount}`);
      for (const reason of file.reasons) {
        lines.push(`         ${pc.dim("-")} ${pc.dim(reason)}`);
      }
    }
  }

  if (report.suggestedReviewers.length > 0) {
    lines.push("");
    lines.push(pc.bold("Suggested reviewers:"));
    for (const reviewer of report.suggestedReviewers) {
      lines.push(`  ${pc.cyan("-")} ${reviewer}`);
    }
  }

  return lines;
}

// ── Command handler ───────────────────────────────────────────────

export async function analyzeCommand(args: string[], ctx: CLIContext): Promise<void> {
  const riskMode = hasFlag(args, "--risk");

  const content = resolveDiffContent(args);
  if (!content?.trim()) {
    p.log.info(`  ${pc.dim("$")} dojops analyze diff <diff-content>`);
    p.log.info(`  ${pc.dim("$")} dojops analyze diff --diff-file <path>`);
    p.log.info(`  ${pc.dim("$")} cat diff.txt | dojops analyze diff`);
    p.log.info(`  ${pc.dim("$")} dojops analyze diff --risk --diff-file <path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No diff content provided.");
  }

  if (riskMode) {
    const report = classifyDiffRisk(content);

    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    p.note(wrapForNote(formatRiskReport(report).join("\n")), "Diff Risk Classification");
    return;
  }

  const provider = ctx.getProvider();
  const analyzer = createDiffAnalyzer(provider);

  const isStructured = ctx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start("Analyzing infrastructure diff...");
  const analysis = await analyzer.analyze(content);
  if (!isStructured) s.stop("Analysis complete.");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  p.note(wrapForNote(formatAnalysis(analysis).join("\n")), "Infrastructure Diff Analysis");
}
