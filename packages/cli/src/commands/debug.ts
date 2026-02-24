import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDebugger } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence } from "../formatter";

export async function debugCommand(args: string[], ctx: CLIContext): Promise<void> {
  // Subcommand: debug ci <log>
  // args[0] should be "ci" (already parsed from command path)
  const logContent = args.filter((a) => !a.startsWith("-")).join(" ");

  if (!logContent) {
    p.log.error("No CI log content provided.");
    p.log.info(`  ${pc.dim("$")} dojops debug ci <log-content>`);
    process.exit(1);
  }

  const provider = ctx.getProvider();
  const debugger_ = createDebugger(provider);

  const s = p.spinner();
  s.start("Analyzing CI log...");
  const diagnosis = await debugger_.diagnose(logContent);
  s.stop("Analysis complete.");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(diagnosis, null, 2));
    return;
  }

  const bodyLines = [
    `${pc.bold("Error Type:")}  ${pc.red(diagnosis.errorType)}`,
    `${pc.bold("Summary:")}     ${diagnosis.summary}`,
    `${pc.bold("Root Cause:")}  ${diagnosis.rootCause}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(diagnosis.confidence)}`,
  ];

  if (diagnosis.affectedFiles.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Affected Files:"));
    for (const f of diagnosis.affectedFiles) {
      bodyLines.push(`  ${pc.dim("-")} ${pc.underline(f)}`);
    }
  }

  if (diagnosis.suggestedFixes.length > 0) {
    bodyLines.push("");
    bodyLines.push(pc.bold("Suggested Fixes:"));
    for (const fix of diagnosis.suggestedFixes) {
      bodyLines.push(`  ${formatConfidence(fix.confidence)} ${fix.description}`);
      if (fix.command) bodyLines.push(`       ${pc.dim("$")} ${pc.cyan(fix.command)}`);
      if (fix.file) bodyLines.push(`       ${pc.dim("File:")} ${pc.underline(fix.file)}`);
    }
  }

  p.note(bodyLines.join("\n"), "CI Diagnosis");
}
