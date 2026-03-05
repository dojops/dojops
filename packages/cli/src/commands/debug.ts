import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDebugger } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, wrapForNote } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue } from "../parser";
import { readStdin } from "../stdin";

export async function debugCommand(args: string[], ctx: CLIContext): Promise<void> {
  // Resolve content from: --file flag > stdin > positional args
  const filePath = extractFlagValue(args, "--file");
  let logContent: string | undefined;

  if (filePath) {
    try {
      logContent = fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Cannot read file: ${filePath}`);
    }
  } else {
    const stdinContent = readStdin();
    if (stdinContent?.trim()) {
      logContent = stdinContent;
    } else {
      logContent = args.filter((a) => !a.startsWith("-")).join(" ");
    }
  }

  if (!logContent || !logContent.trim()) {
    p.log.info(`  ${pc.dim("$")} dojops debug ci <log-content>`);
    p.log.info(`  ${pc.dim("$")} dojops debug ci --file <path>`);
    p.log.info(`  ${pc.dim("$")} cat ci.log | dojops debug ci`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No CI log content provided.");
  }

  const provider = ctx.getProvider();
  const debugger_ = createDebugger(provider);

  const isStructured = ctx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start("Analyzing CI log...");
  const diagnosis = await debugger_.diagnose(logContent);
  if (!isStructured) s.stop("Analysis complete.");

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
    bodyLines.push("", pc.bold("Affected Files:"));
    for (const f of diagnosis.affectedFiles) {
      bodyLines.push(`  ${pc.dim("-")} ${pc.underline(f)}`);
    }
  }

  if (diagnosis.suggestedFixes.length > 0) {
    bodyLines.push("", pc.bold("Suggested Fixes:"));
    for (const fix of diagnosis.suggestedFixes) {
      bodyLines.push(`  ${formatConfidence(fix.confidence)} ${fix.description}`);
      if (fix.command) bodyLines.push(`       ${pc.dim("$")} ${pc.cyan(fix.command)}`);
      if (fix.file) bodyLines.push(`       ${pc.dim("File:")} ${pc.underline(fix.file)}`);
    }
  }

  p.note(wrapForNote(bodyLines.join("\n")), "CI Diagnosis");
}
