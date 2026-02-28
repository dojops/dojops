import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDiffAnalyzer } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, riskColor, changeColor } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue } from "../parser";
import { readStdin } from "../stdin";

export async function analyzeCommand(args: string[], ctx: CLIContext): Promise<void> {
  // Resolve content from: --file flag > stdin > positional args
  const filePath = extractFlagValue(args, "--file");
  let content: string | undefined;

  if (filePath) {
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Cannot read file: ${filePath}`);
    }
  } else {
    const stdinContent = readStdin();
    if (stdinContent && stdinContent.trim()) {
      content = stdinContent;
    } else {
      content = args.filter((a) => !a.startsWith("-")).join(" ");
    }
  }

  if (!content || !content.trim()) {
    p.log.info(`  ${pc.dim("$")} dojops analyze diff <diff-content>`);
    p.log.info(`  ${pc.dim("$")} dojops analyze diff --file <path>`);
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

  const bodyLines = [
    `${pc.bold("Summary:")}     ${analysis.summary}`,
    `${pc.bold("Risk Level:")}  ${riskColor(analysis.riskLevel)}`,
    `${pc.bold("Cost Impact:")} ${analysis.costImpact.direction} — ${analysis.costImpact.details}`,
    `${pc.bold("Rollback:")}    ${analysis.rollbackComplexity}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(analysis.confidence)}`,
  ];

  if (analysis.changes.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold(`Changes (${analysis.changes.length}):`));
    for (const change of analysis.changes) {
      const detail = change.attribute ? pc.dim(` (${change.attribute})`) : "";
      const action = changeColor(change.action.toUpperCase());
      bodyLines.push(`  ${action} ${change.resource}${detail}`);
    }
  }

  if (analysis.riskFactors.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Risk Factors:"));
    for (const r of analysis.riskFactors) {
      bodyLines.push(`  ${pc.yellow("-")} ${r}`);
    }
  }

  if (analysis.securityImpact.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Security Impact:"));
    for (const si of analysis.securityImpact) {
      bodyLines.push(`  ${pc.red("-")} ${si}`);
    }
  }

  if (analysis.recommendations.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Recommendations:"));
    for (const rec of analysis.recommendations) {
      bodyLines.push(`  ${pc.blue("-")} ${rec}`);
    }
  }

  p.note(bodyLines.join("\n"), "Infrastructure Diff Analysis");
}
