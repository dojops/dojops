import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DevOpsChecker } from "@dojops/core";
import { CommandHandler } from "../types";
import { findProjectRoot, loadContext, appendAudit, getCurrentUser } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024; // 50 KB

export const checkCommand: CommandHandler = async (_args, cliCtx) => {
  // F-6: `dojops check provider` — test provider connectivity
  if (_args[0] === "provider") {
    return checkProviderCommand(_args.slice(1), cliCtx);
  }

  const start = Date.now();
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `No .dojops/ project found. Run dojops init first.`,
    );
  }

  const ctx = loadContext(root);
  if (!ctx) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Could not load context.json. Run dojops init to regenerate.`,
    );
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
    p.log.info(`Run ${pc.cyan("dojops config")} to configure a provider.`);
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `LLM provider required. ${(err as Error).message}`,
    );
  }

  const isStructured = cliCtx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start(`Analyzing ${fileContents.length} DevOps files...`);

  const checker = new DevOpsChecker(provider);

  // Strip rootPath from context for privacy
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rootPath: _rp, ...contextForLLM } = ctx;
  const contextJson = JSON.stringify(contextForLLM, null, 2);

  try {
    const report = await checker.check(contextJson, fileContents);
    if (!isStructured) s.stop("Analysis complete.");

    const durationMs = Date.now() - start;

    // JSON output mode
    if (cliCtx.globalOpts.output === "json") {
      console.log(JSON.stringify(report, null, 2));
      appendAudit(root, {
        timestamp: new Date().toISOString(),
        user: getCurrentUser(),
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
      user: getCurrentUser(),
      command: "check",
      action: "devops-check",
      status: "success",
      durationMs,
    });
  } catch (err) {
    if (!isStructured) s.stop("Analysis failed.");
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: "check",
      action: "devops-check",
      status: "failure",
      durationMs: Date.now() - start,
    });
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/** F-6: Provider connectivity test — `dojops check provider` */
async function checkProviderCommand(
  _args: string[],
  cliCtx: Parameters<CommandHandler>[1],
): Promise<void> {
  let provider;
  try {
    provider = cliCtx.getProvider();
  } catch (err) {
    p.log.info(`Run ${pc.cyan("dojops config")} to configure a provider.`);
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `LLM provider required. ${(err as Error).message}`,
    );
  }

  const isStructured = cliCtx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start(`Testing ${provider.name} connectivity...`);

  const start = Date.now();
  try {
    if (provider.listModels) {
      const models = await provider.listModels();
      const latency = Date.now() - start;

      if (cliCtx.globalOpts.output === "json") {
        if (!isStructured) s.stop("Done.");
        console.log(
          JSON.stringify({
            status: "ok",
            provider: provider.name,
            latencyMs: latency,
            models: models.length,
          }),
        );
        return;
      }

      if (!isStructured) s.stop(`Connected to ${pc.bold(provider.name)} (${latency}ms)`);
      p.log.success(
        `Provider ${pc.bold(provider.name)} is reachable. ${models.length} models available.`,
      );
    } else {
      const latency = Date.now() - start;
      if (!isStructured) s.stop("Done.");

      if (cliCtx.globalOpts.output === "json") {
        console.log(
          JSON.stringify({
            status: "ok",
            provider: provider.name,
            latencyMs: latency,
            note: "listModels not supported",
          }),
        );
        return;
      }

      p.log.success(
        `Provider ${pc.bold(provider.name)} configured (listModels not supported — cannot verify connectivity).`,
      );
    }
  } catch (err) {
    const latency = Date.now() - start;
    if (!isStructured) s.stop("Connection failed.");

    if (cliCtx.globalOpts.output === "json") {
      console.log(
        JSON.stringify({
          status: "error",
          provider: provider.name,
          latencyMs: latency,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return;
    }

    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Provider ${provider.name} connectivity check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
