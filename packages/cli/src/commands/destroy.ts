import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import {
  findProjectRoot,
  loadPlan,
  listExecutions,
  appendAudit,
  acquireLock,
  releaseLock,
  isLocked,
} from "../state";
import { ExitCode } from "../exit-codes";

export async function destroyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .dojops/ project found. Run `dojops init` first.");
    process.exit(ExitCode.NO_PROJECT);
  }

  const dryRun = hasFlag(args, "--dry-run");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const planId = args.find((a) => !a.startsWith("-"));
  if (!planId) {
    p.log.error("Plan ID required for destroy (safety measure).");
    p.log.info(`  ${pc.dim("$")} dojops destroy <plan-id>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    p.log.error(`Plan "${planId}" not found.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  // Collect files from execution records (same source as rollback)
  const executions = listExecutions(root).filter((e) => e.planId === planId);
  const execFiles = executions.flatMap((e) => e.filesCreated);

  // Also include plan.files for backward compatibility
  const allFiles = [...new Set([...plan.files, ...execFiles])];

  if (allFiles.length === 0) {
    p.log.info("No files to destroy for this plan.");
    return;
  }

  // Show what will be destroyed
  const lines = allFiles.map((f) => `  ${pc.red("-")} ${f}`);
  p.note(lines.join("\n"), pc.red(`Destroy artifacts from ${plan.id}`));

  if (dryRun) {
    p.log.info(`${allFiles.length} file(s) would be deleted.`);
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
  }

  if (!autoApprove) {
    const confirm = await p.confirm({
      message: `Delete ${allFiles.length} file(s)? This cannot be undone.`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  if (!acquireLock(root, "destroy")) {
    const { info } = isLocked(root);
    p.log.error(`Operation locked by PID ${info?.pid} (${info?.operation})`);
    process.exit(ExitCode.LOCK_CONFLICT);
  }

  const startTime = Date.now();
  try {
    let deleted = 0;
    for (const file of allFiles) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          p.log.success(`Deleted: ${file}`);
          deleted++;
        } else {
          p.log.warn(`Not found: ${file}`);
        }
      } catch (err) {
        p.log.error(`Failed to delete ${file}: ${(err as Error).message}`);
      }
    }

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: `destroy ${planId}`,
      action: "destroy",
      planId,
      status: "success",
      durationMs: Date.now() - startTime,
    });

    p.log.success(`Destroyed ${deleted}/${allFiles.length} artifacts.`);
  } finally {
    releaseLock(root);
  }
}
