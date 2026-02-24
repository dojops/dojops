import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDiffAnalyzer } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, riskColor, changeColor } from "../formatter";

export async function analyzeCommand(args: string[], ctx: CLIContext): Promise<void> {
  // Subcommands: analyze diff <content>
  const content = args.filter((a) => !a.startsWith("-")).join(" ");

  if (!content) {
    p.log.error("No diff content provided.");
    p.log.info(`  ${pc.dim("$")} dojops analyze diff <diff-content>`);
    process.exit(1);
  }

  const provider = ctx.getProvider();
  const analyzer = createDiffAnalyzer(provider);

  const s = p.spinner();
  s.start("Analyzing infrastructure diff...");
  const analysis = await analyzer.analyze(content);
  s.stop("Analysis complete.");

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
