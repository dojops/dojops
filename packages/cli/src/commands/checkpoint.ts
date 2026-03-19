import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  cleanCheckpoints,
} from "@dojops/executor";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

function getRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Not inside a project. Run `dojops init` first.");
  }
  return root;
}

function handleCreate(args: string[], ctx: CLIContext): void {
  const root = getRoot();
  const name = args[0];
  const entry = createCheckpoint(root, name);

  if (!entry) {
    p.log.info("No changes to checkpoint.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  p.log.success(`Checkpoint ${pc.cyan(entry.id)}${name ? ` (${pc.bold(name)})` : ""} created`);
  if (entry.filesTracked.length > 0) {
    p.log.info(pc.dim(`Files: ${entry.filesTracked.join(", ")}`));
  }
}

function handleList(ctx: CLIContext): void {
  const root = getRoot();
  const entries = listCheckpoints(root);

  if (entries.length === 0) {
    p.log.info("No checkpoints.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  for (const e of entries) {
    const label = e.name ? `${pc.cyan(e.id)} ${pc.bold(e.name)}` : pc.cyan(e.id);
    const time = pc.dim(new Date(e.timestamp).toLocaleString());
    const files = e.filesTracked.length > 0 ? pc.dim(` — ${e.filesTracked.join(", ")}`) : "";
    p.log.message(`  ${label}  ${time}${files}`);
  }
}

function handleRestore(args: string[], ctx: CLIContext): void {
  const root = getRoot();
  const idOrName = args[0];
  if (!idOrName) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops checkpoint restore <id|name>");
  }

  const entry = restoreCheckpoint(root, idOrName);
  if (!entry) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Checkpoint "${idOrName}" not found.`);
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  p.log.success(`Restored checkpoint ${pc.cyan(entry.id)}${entry.name ? ` (${entry.name})` : ""}`);
}

function handleClean(): void {
  const root = getRoot();
  const count = cleanCheckpoints(root);
  p.log.success(`Removed ${count} checkpoint${count !== 1 ? "s" : ""}.`);
}

export async function checkpointCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0] ?? "list";
  const rest = args.slice(1);

  switch (sub) {
    case "create":
      handleCreate(rest, ctx);
      break;
    case "list":
      handleList(ctx);
      break;
    case "restore":
      handleRestore(rest, ctx);
      break;
    case "clean":
      handleClean();
      break;
    default:
      handleCreate([sub, ...rest], ctx);
      break;
  }
}
