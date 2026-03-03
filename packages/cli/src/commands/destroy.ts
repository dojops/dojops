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
  getCurrentUser,
} from "../state";
import { ExitCode, CLIError } from "../exit-codes";

export async function cleanCommand(
  args: string[],
  ctx: CLIContext,
  isLegacyDestroy = false,
): Promise<void> {
  if (isLegacyDestroy) {
    p.log.warn(pc.yellow("'destroy' is deprecated. Use 'clean' instead."));
  }

  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }

  const dryRun = hasFlag(args, "--dry-run");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const planId = args.find((a) => !a.startsWith("-"));
  if (!planId) {
    p.log.info(`  ${pc.dim("$")} dojops clean <plan-id>`);

    // UX #13: List available plans to help the user
    const { listPlans } = await import("../state");
    const plans = listPlans(root);
    if (plans.length > 0) {
      p.log.info("");
      p.log.info(pc.bold("Available plans:"));
      for (const plan of plans.slice(0, 10)) {
        const status = plan.approvalStatus ?? "PENDING";
        const date = new Date(plan.createdAt).toLocaleDateString();
        p.log.info(`  ${pc.cyan(plan.id)} ${pc.dim(`(${status}, ${date})`)} ${plan.goal}`);
      }
      if (plans.length > 10) {
        p.log.info(pc.dim(`  ...and ${plans.length - 10} more`));
      }
    }

    throw new CLIError(ExitCode.VALIDATION_ERROR, "Plan ID required for clean (safety measure).");
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);
  }

  // Collect files from execution records (same source as rollback)
  const executions = listExecutions(root).filter((e) => e.planId === planId);
  const execFiles = executions.flatMap((e) => e.filesCreated);

  // Also include plan.files for backward compatibility
  const allFiles = [...new Set([...plan.files, ...execFiles])];

  if (allFiles.length === 0) {
    p.log.info("No files to clean for this plan.");
    return;
  }

  // Show what will be destroyed
  const lines = allFiles.map((f) => `  ${pc.red("-")} ${f}`);
  p.note(lines.join("\n"), pc.red(`Clean artifacts from ${plan.id}`));

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

  if (!acquireLock(root, "clean")) {
    const { info } = isLocked(root);
    throw new CLIError(
      ExitCode.LOCK_CONFLICT,
      `Operation locked by PID ${info?.pid} (${info?.operation})`,
    );
  }

  const startTime = Date.now();
  try {
    let deleted = 0;
    for (const file of allFiles) {
      try {
        const absFile = path.resolve(file);
        if (!absFile.startsWith(root + path.sep)) {
          p.log.warn(`Skipping out-of-project file: ${file}`);
          continue;
        }
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
      user: getCurrentUser(),
      command: `clean ${planId}`,
      action: "clean",
      planId,
      status: "success",
      durationMs: Date.now() - startTime,
    });

    p.log.success(`Cleaned ${deleted}/${allFiles.length} artifacts.`);
  } finally {
    releaseLock(root);
  }
}
