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

export async function rollbackCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .oda/ project found. Run `oda init` first.");
    process.exit(ExitCode.NO_PROJECT);
  }

  const dryRun = hasFlag(args, "--dry-run");
  const planId = args.find((a) => !a.startsWith("-"));
  if (!planId) {
    p.log.error("Plan ID required for rollback.");
    p.log.info(`  ${pc.dim("$")} oda rollback <plan-id>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    p.log.error(`Plan "${planId}" not found.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  // Find execution records for this plan
  const executions = listExecutions(root).filter((e) => e.planId === planId);
  if (executions.length === 0) {
    p.log.error(`No execution records found for plan "${planId}".`);
    p.log.info("Only applied plans can be rolled back.");
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const latest = executions[0];
  const filesToDelete = latest.filesCreated;

  if (filesToDelete.length === 0) {
    p.log.info("No files to roll back.");
    return;
  }

  const lines = filesToDelete.map((f) => `  ${pc.red("-")} ${f}`);
  p.note(lines.join("\n"), pc.yellow(`Rollback plan ${planId}`));

  if (dryRun) {
    p.log.info(`${filesToDelete.length} file(s) would be removed.`);
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
  }

  if (!ctx.globalOpts.nonInteractive) {
    const confirm = await p.confirm({
      message: `Delete ${filesToDelete.length} created file(s)?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  if (!acquireLock(root, "rollback")) {
    const { info } = isLocked(root);
    p.log.error(`Operation locked by PID ${info?.pid} (${info?.operation})`);
    process.exit(ExitCode.LOCK_CONFLICT);
  }

  const startTime = Date.now();
  try {
    let deleted = 0;
    for (const file of filesToDelete) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          p.log.success(`Removed: ${file}`);
          deleted++;
        } else {
          p.log.warn(`Not found: ${file}`);
        }
      } catch (err) {
        p.log.error(`Failed: ${(err as Error).message}`);
      }
    }

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: `rollback ${planId}`,
      action: "rollback",
      planId,
      status: "success",
      durationMs: Date.now() - startTime,
    });

    p.log.success(`Rolled back ${deleted}/${filesToDelete.length} files.`);
  } finally {
    releaseLock(root);
  }
}
