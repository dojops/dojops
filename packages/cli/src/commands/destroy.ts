import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, loadPlan, appendAudit } from "../state";

export async function destroyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .oda/ project found. Run `oda init` first.");
    process.exit(1);
  }

  const planId = args.find((a) => !a.startsWith("-"));
  if (!planId) {
    p.log.error("Plan ID required for destroy (safety measure).");
    p.log.info(`  ${pc.dim("$")} oda destroy <plan-id>`);
    process.exit(1);
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    p.log.error(`Plan "${planId}" not found.`);
    process.exit(1);
  }

  if (plan.files.length === 0) {
    p.log.info("No files to destroy for this plan.");
    return;
  }

  // Show what will be destroyed
  const lines = plan.files.map((f) => `  ${pc.red("-")} ${f}`);
  p.note(lines.join("\n"), pc.red(`Destroy artifacts from ${plan.id}`));

  if (!ctx.globalOpts.nonInteractive) {
    const confirm = await p.confirm({
      message: `Delete ${plan.files.length} file(s)? This cannot be undone.`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  const startTime = Date.now();
  let deleted = 0;
  for (const file of plan.files) {
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

  p.log.success(`Destroyed ${deleted}/${plan.files.length} artifacts.`);
}
