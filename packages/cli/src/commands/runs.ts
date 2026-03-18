import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { ExitCode, CLIError } from "../exit-codes";
import {
  listRuns,
  readRunMeta,
  readRunResult,
  cleanOldRuns,
  outputLogPath,
  RunMeta,
} from "../runs";

function getRoot(): string {
  const root = findProjectRoot();
  if (!root)
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Not inside a project. Run `dojops init` first.");
  return root;
}

function formatStatus(status: RunMeta["status"]): string {
  switch (status) {
    case "running":
      return pc.cyan("running");
    case "completed":
      return pc.green("completed");
    case "failed":
      return pc.red("failed");
    default:
      return status;
  }
}

function formatDuration(startedAt: string, completedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function handleList(ctx: CLIContext): void {
  const rootDir = getRoot();
  const runs = listRuns(rootDir);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }

  if (runs.length === 0) {
    p.log.info("No background runs. Start one with: dojops auto --background <prompt>");
    return;
  }

  const lines = runs.map((r) => {
    const prompt = r.prompt.length > 50 ? r.prompt.slice(0, 47) + "..." : r.prompt;
    const duration = formatDuration(r.startedAt, r.completedAt);
    return `${pc.cyan(r.id.slice(0, 8))}  ${formatStatus(r.status)}  ${pc.dim(duration)}  ${prompt}`;
  });
  p.note(lines.join("\n"), `Background runs (${runs.length})`);
}

function handleShow(args: string[], ctx: CLIContext): void {
  const rootDir = getRoot();
  const idPrefix = args[0];
  if (!idPrefix) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops runs show <id>");
  }

  // Support prefix matching
  const runs = listRuns(rootDir);
  const match = runs.find((r) => r.id.startsWith(idPrefix));
  if (!match) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `No run found matching "${idPrefix}".`);
  }

  const meta = readRunMeta(rootDir, match.id);
  if (!meta) {
    throw new CLIError(ExitCode.GENERAL_ERROR, `Could not read run metadata for "${match.id}".`);
  }

  const result = readRunResult(rootDir, match.id);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ meta, result }, null, 2));
    return;
  }

  p.log.info(`${pc.bold("Run ID:")}     ${meta.id}`);
  p.log.info(`${pc.bold("Status:")}     ${formatStatus(meta.status)}`);
  p.log.info(`${pc.bold("Prompt:")}     ${meta.prompt}`);
  p.log.info(`${pc.bold("Started:")}    ${meta.startedAt}`);
  if (meta.completedAt) {
    p.log.info(`${pc.bold("Completed:")}  ${meta.completedAt}`);
    p.log.info(`${pc.bold("Duration:")}   ${formatDuration(meta.startedAt, meta.completedAt)}`);
  }
  p.log.info(`${pc.bold("PID:")}        ${meta.pid}`);

  if (result) {
    console.log();
    p.log.info(pc.bold("Result:"));
    p.log.info(`  Success: ${result.success ? pc.green("yes") : pc.red("no")}`);
    p.log.info(`  Summary: ${result.summary}`);
    p.log.info(
      pc.dim(
        `  ${result.iterations} iterations · ${result.toolCalls} tool calls · ${result.totalTokens.toLocaleString()} tokens`,
      ),
    );
    if (result.filesWritten.length > 0) {
      p.log.success(`  Created: ${result.filesWritten.join(", ")}`);
    }
    if (result.filesModified.length > 0) {
      p.log.success(`  Modified: ${result.filesModified.join(", ")}`);
    }
  }

  // Tail output log
  const logFile = outputLogPath(rootDir, meta.id);
  if (fs.existsSync(logFile)) {
    const log = fs.readFileSync(logFile, "utf8");
    const lines = log.split("\n");
    const tail = lines.slice(-20).join("\n");
    if (tail.trim()) {
      console.log();
      p.note(tail, `Output log (last 20 lines)`);
    }
  }
}

function handleClean(args: string[]): void {
  const rootDir = getRoot();
  const maxAgeDays = args[0] ? Number.parseInt(args[0], 10) : 7;
  const removed = cleanOldRuns(rootDir, maxAgeDays);
  if (removed > 0) {
    p.log.success(`Removed ${removed} old run${removed === 1 ? "" : "s"}.`);
  } else {
    p.log.info("No old runs to clean up.");
  }
}

export async function runsCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0] ?? "list";
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      handleList(ctx);
      break;
    case "show":
      handleShow(rest, ctx);
      break;
    case "clean":
      handleClean(rest);
      break;
    default:
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Unknown runs subcommand: "${sub}". Available: list, show, clean`,
      );
  }
}
