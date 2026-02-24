import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DevOpsChecker } from "@dojops/core";
import { CommandHandler } from "../types";
import { findProjectRoot, loadContext, appendAudit } from "../state";
import { ExitCode } from "../exit-codes";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024; // 50 KB

export const checkCommand: CommandHandler = async (_args, cliCtx) => {
  const start = Date.now();
  const root = findProjectRoot();
  if (!root) {
    p.log.error(`No .dojops/ project found. Run ${pc.cyan("dojops init")} first.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const ctx = loadContext(root);
  if (!ctx) {
    p.log.error(`Could not load context.json. Run ${pc.cyan("dojops init")} to regenerate.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  if (ctx.devopsFiles.length === 0) {
    p.log.warn("No DevOps files detected in context. Nothing to check.");
    return;
  }

  // Read file contents (up to MAX_FILES, each up to MAX_FILE_SIZE)
  const fileContents: { path: string; content: string }[] = [];
  for (const filePath of ctx.devopsFiles.slice(0, MAX_FILES)) {
    const absPath = path.join(root, filePath);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(absPath, "utf-8");
      fileContents.push({ path: filePath, content });
    } catch {
      // File missing or unreadable — skip
    }
  }

  if (fileContents.length === 0) {
    p.log.warn("Could not read any DevOps files. Nothing to check.");
    return;
  }

  // Get provider
  let provider;
  try {
    provider = cliCtx.getProvider();
  } catch (err) {
    p.log.error(`LLM provider required. ${(err as Error).message}`);
    p.log.info(`Run ${pc.cyan("dojops config")} to configure a provider.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const s = p.spinner();
  s.start(`Analyzing ${fileContents.length} DevOps files...`);

  const checker = new DevOpsChecker(provider);

  // Strip rootPath from context for privacy
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rootPath: _rp, ...contextForLLM } = ctx;
  const contextJson = JSON.stringify(contextForLLM, null, 2);

  try {
    const report = await checker.check(contextJson, fileContents);
    s.stop("Analysis complete.");

    const durationMs = Date.now() - start;

    // JSON output mode
    if (cliCtx.globalOpts.output === "json") {
      console.log(JSON.stringify(report, null, 2));
      appendAudit(root, {
        timestamp: new Date().toISOString(),
        user: process.env.USER ?? "unknown",
        command: "check",
        action: "devops-check",
        status: "success",
        durationMs,
      });
      return;
    }

    // Maturity score
    const scoreColor =
      report.score >= 76
        ? pc.green
        : report.score >= 51
          ? pc.cyan
          : report.score >= 26
            ? pc.yellow
            : pc.red;
    const scoreLabel =
      report.score >= 76
        ? "Excellent"
        : report.score >= 51
          ? "Good"
          : report.score >= 26
            ? "Basic"
            : "Minimal";

    p.note(
      [
        `${pc.bold("Score:")} ${scoreColor(`${report.score}/100`)} ${pc.dim(`(${scoreLabel})`)}`,
        "",
        report.summary,
      ].join("\n"),
      "DevOps Maturity",
    );

    // Findings by severity
    const severityOrder = ["critical", "error", "warning", "info"] as const;
    const severityColors: Record<string, (s: string) => string> = {
      critical: pc.red,
      error: pc.red,
      warning: pc.yellow,
      info: pc.dim,
    };

    if (report.findings.length > 0) {
      const lines: string[] = [];
      for (const sev of severityOrder) {
        const items = report.findings.filter((f) => f.severity === sev);
        if (items.length === 0) continue;
        const color = severityColors[sev];
        lines.push(`${color(pc.bold(sev.toUpperCase()))} (${items.length})`);
        for (const f of items) {
          lines.push(`  ${color("●")} ${pc.cyan(f.file)} — ${f.message}`);
          lines.push(`    ${pc.dim("→")} ${f.recommendation}`);
        }
        lines.push("");
      }
      p.note(lines.join("\n"), `Findings (${report.findings.length})`);
    } else {
      p.log.success("No findings — your DevOps configuration looks great!");
    }

    // Missing files
    if (report.missingFiles.length > 0) {
      const missingLines = report.missingFiles.map((f) => `  ${pc.yellow("○")} ${f}`);
      p.note(missingLines.join("\n"), "Recommended missing files");
    }

    // Audit
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: "check",
      action: "devops-check",
      status: "success",
      durationMs,
    });
  } catch (err) {
    s.stop("Analysis failed.");
    p.log.error(`Check failed: ${err instanceof Error ? err.message : String(err)}`);

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: "check",
      action: "devops-check",
      status: "failure",
      durationMs: Date.now() - start,
    });
    process.exit(ExitCode.VALIDATION_ERROR);
  }
};
