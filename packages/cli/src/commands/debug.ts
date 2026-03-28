import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createDebugger } from "@dojops/api";
import { CLIContext } from "../types";
import { formatConfidence, wrapForNote } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue } from "../parser";
import { readStdin } from "../stdin";
import { findProjectRoot, saveDebugOutput } from "../state";

/** Resolve content from --file flag, stdin, or positional args. */
function resolveInputContent(args: string[]): string | undefined {
  const filePath = extractFlagValue(args, "--file");
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Cannot read file: ${filePath}`);
    }
  }
  const stdinContent = readStdin();
  if (stdinContent?.trim()) return stdinContent;
  return args.filter((a) => !a.startsWith("-")).join(" ") || undefined;
}

/** Format the CI diagnosis into display lines. */
function formatDiagnosis(diagnosis: {
  errorType: string;
  summary: string;
  rootCause: string;
  confidence: number;
  affectedFiles: string[];
  suggestedFixes: Array<{
    confidence: number;
    description: string;
    command?: string | null;
    file?: string | null;
  }>;
}): string[] {
  const lines = [
    `${pc.bold("Error Type:")}  ${pc.red(diagnosis.errorType)}`,
    `${pc.bold("Summary:")}     ${diagnosis.summary}`,
    `${pc.bold("Root Cause:")}  ${diagnosis.rootCause}`,
    `${pc.bold("Confidence:")}  ${formatConfidence(diagnosis.confidence)}`,
  ];
  if (diagnosis.affectedFiles.length > 0) {
    lines.push("", pc.bold("Affected Files:"));
    for (const f of diagnosis.affectedFiles) {
      lines.push(`  ${pc.dim("-")} ${pc.underline(f)}`);
    }
  }
  if (diagnosis.suggestedFixes.length > 0) {
    lines.push("", pc.bold("Suggested Fixes:"));
    for (const fix of diagnosis.suggestedFixes) {
      lines.push(`  ${formatConfidence(fix.confidence)} ${fix.description}`);
      if (fix.command) lines.push(`       ${pc.dim("$")} ${pc.cyan(fix.command)}`);
      if (fix.file) lines.push(`       ${pc.dim("File:")} ${pc.underline(fix.file)}`);
    }
  }
  return lines;
}

export async function debugCommand(args: string[], ctx: CLIContext): Promise<void> {
  const logContent = resolveInputContent(args);
  if (!logContent?.trim()) {
    p.log.info(`  ${pc.dim("$")} dojops debug ci <log-content>`);
    p.log.info(`  ${pc.dim("$")} dojops debug ci --file <path>`);
    p.log.info(`  ${pc.dim("$")} cat ci.log | dojops debug ci`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No CI log content provided.");
  }

  // Save raw log to .dojops/debug/ for recovery
  const root = findProjectRoot();
  if (root) {
    saveDebugOutput(root, "ci-log", logContent, { command: "debug ci" });
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

  p.note(wrapForNote(formatDiagnosis(diagnosis).join("\n")), "CI Diagnosis");
}
