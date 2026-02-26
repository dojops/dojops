import fs from "node:fs";
import path from "node:path";
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

function restoreBackup(filePath: string): boolean {
  const bakPath = `${filePath}.bak`;
  if (fs.existsSync(bakPath)) {
    fs.renameSync(bakPath, filePath);
    return true;
  }
  return false;
}

export async function rollbackCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .dojops/ project found. Run `dojops init` first.");
    process.exit(ExitCode.NO_PROJECT);
  }

  const dryRun = hasFlag(args, "--dry-run");
  const planId = args.find((a) => !a.startsWith("-"));
  if (!planId) {
    p.log.error("Plan ID required for rollback.");
    p.log.info(`  ${pc.dim("$")} dojops rollback <plan-id>`);
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
  const filesToRestore = latest.filesModified ?? [];

  if (filesToDelete.length === 0 && filesToRestore.length === 0) {
    p.log.info("No files to roll back.");
    return;
  }

  const lines: string[] = [];
  for (const f of filesToDelete) {
    lines.push(`  ${pc.red("-")} ${f}`);
  }
  for (const f of filesToRestore) {
    lines.push(`  ${pc.yellow("↩")} ${f} ${pc.dim("(restore from .bak)")}`);
  }
  p.note(lines.join("\n"), pc.yellow(`Rollback plan ${planId}`));

  if (dryRun) {
    if (filesToDelete.length > 0) {
      p.log.info(`${filesToDelete.length} file(s) would be removed.`);
    }
    if (filesToRestore.length > 0) {
      p.log.info(`${filesToRestore.length} file(s) would be restored from .bak.`);
    }
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
  }

  const totalActions = filesToDelete.length + filesToRestore.length;
  const skipPrompt = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  if (!skipPrompt) {
    const confirm = await p.confirm({
      message: `Roll back ${totalActions} file(s)?`,
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
        const absFile = path.resolve(file);
        if (!absFile.startsWith(root + path.sep)) {
          p.log.warn(`Skipping out-of-project file: ${file}`);
          continue;
        }
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

    let restored = 0;
    for (const file of filesToRestore) {
      try {
        if (restoreBackup(file)) {
          p.log.success(`Restored: ${file}`);
          restored++;
        } else {
          p.log.warn(`No .bak found: ${file}`);
        }
      } catch (err) {
        p.log.error(`Restore failed: ${(err as Error).message}`);
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

    const parts: string[] = [];
    if (filesToDelete.length > 0) parts.push(`${deleted}/${filesToDelete.length} removed`);
    if (filesToRestore.length > 0) parts.push(`${restored}/${filesToRestore.length} restored`);
    p.log.success(`Rolled back: ${parts.join(", ")}.`);
  } finally {
    releaseLock(root);
  }
}
