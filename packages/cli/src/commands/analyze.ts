import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDiffAnalyzer } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, riskColor, changeColor, wrapForNote } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue } from "../parser";
import { readStdin } from "../stdin";

/** Known CLI flags that can appear in analyze diff args. */
const ANALYZE_FLAGS = new Set([
  "--non-interactive",
  "--quiet",
  "--verbose",
  "--debug",
  "--no-color",
  "--output",
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

export async function analyzeCommand(args: string[], ctx: CLIContext): Promise<void> {
  const content = resolveDiffContent(args);
  if (!content?.trim()) {
    p.log.info(`  ${pc.dim("$")} dojops analyze diff <diff-content>`);
    p.log.info(`  ${pc.dim("$")} dojops analyze diff --diff-file <path>`);
    p.log.info(`  ${pc.dim("$")} cat diff.txt | dojops analyze diff`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No diff content provided.");
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
