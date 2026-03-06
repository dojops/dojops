import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DevOpsChecker } from "@dojops/core";
import { CommandHandler } from "../types";
import { wrapForNote } from "../formatter";
import { hasFlag } from "../parser";
import { findProjectRoot, loadContext, appendAudit, getCurrentUser } from "../state";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024; // 50 KB

function readDevopsFiles(root: string, devopsFiles: string[]): { path: string; content: string }[] {
  const fileContents: { path: string; content: string }[] = [];
  for (const filePath of devopsFiles.slice(0, MAX_FILES)) {
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
  return fileContents;
}

function getScoreStyle(score: number): { color: (s: string) => string; label: string } {
  if (score >= 76) return { color: pc.green, label: "Excellent" };
  if (score >= 51) return { color: pc.cyan, label: "Good" };
  if (score >= 26) return { color: pc.yellow, label: "Basic" };
  return { color: pc.red, label: "Minimal" };
}

function renderFindings(
  findings: Array<{ severity: string; file: string; message: string; recommendation: string }>,
): void {
  const severityOrder = ["critical", "error", "warning", "info"] as const;
  const severityColors: Record<string, (s: string) => string> = {
    critical: pc.red,
    error: pc.red,
    warning: pc.yellow,
    info: pc.dim,
  };

  if (findings.length > 0) {
    const lines: string[] = [];
    for (const sev of severityOrder) {
      const items = findings.filter((f) => f.severity === sev);
      if (items.length === 0) continue;
      const color = severityColors[sev];
      lines.push(`${color(pc.bold(sev.toUpperCase()))} (${items.length})`);
      for (const f of items) {
        lines.push(
          `  ${color("●")} ${pc.cyan(f.file)} — ${f.message}`,
          `    ${pc.dim("→")} ${f.recommendation}`,
        );
      }
      lines.push("");
    }
    p.note(wrapForNote(lines.join("\n")), `Findings (${findings.length})`);
  } else {
    p.log.success("No findings — your DevOps configuration looks great!");
  }
}

function applyFixContent(fixContent: string, root: string): number {
  const fileRegex = /FILE:\s*(.+?)\n```[^\n]*\n([\s\S]*?)```/g;
  let match;
  let filesFixed = 0;
  while ((match = fileRegex.exec(fixContent)) !== null) {
    const filePath = match[1].trim();
    const content = match[2];
    const absPath = path.join(root, filePath);
    try {
      if (fs.existsSync(absPath)) {
        fs.copyFileSync(absPath, absPath + ".bak");
      }
      fs.writeFileSync(absPath, content, "utf-8");
      p.log.success(`Fixed: ${pc.cyan(filePath)}`);
      filesFixed++;
    } catch (writeErr) {
      p.log.warn(
        `Failed to write ${filePath}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
      );
    }
  }
  return filesFixed;
}

async function handleFixMode(
  report: {
    findings: Array<{ severity: string; file: string; message: string; recommendation: string }>;
  },
  fileContents: { path: string; content: string }[],
  provider: { generate(req: { system: string; prompt: string }): Promise<{ content: string }> },
  root: string,
  autoApprove: boolean,
): Promise<void> {
  const fixableFindings = report.findings.filter(
    (f) => f.severity === "critical" || f.severity === "error",
  );

  if (fixableFindings.length === 0) {
    p.log.info("No critical/error findings to fix.");
    return;
  }

  const fixSpinner = p.spinner();
  fixSpinner.start(`Generating fixes for ${fixableFindings.length} finding(s)...`);

  try {
    const fixPrompt = [
      "You are a DevOps configuration expert. Fix the following issues in the project files.",
      "For each fix, output the complete corrected file content.",
      "",
      "Findings to fix:",
      ...fixableFindings.map(
        (f) => `- [${f.severity}] ${f.file}: ${f.message}\n  Recommendation: ${f.recommendation}`,
      ),
      "",
      "Current file contents:",
      ...fileContents
        .filter((fc) => fixableFindings.some((f) => f.file === fc.path))
        .map((fc) => `\n--- ${fc.path} ---\n${fc.content}`),
    ].join("\n");

    const fixResult = await provider.generate({
      system:
        "You are a DevOps expert. Generate corrected file contents to fix the identified issues. " +
        "Output each fix as: FILE: <path>\n```\n<corrected content>\n```",
      prompt: fixPrompt,
    });

    fixSpinner.stop("Fixes generated.");
    const fixContent = fixResult.content;
    p.note(wrapForNote(fixContent), "Proposed Fixes");

    let approved = autoApprove;
    if (!approved) {
      const confirm = await p.confirm({
        message: `Apply ${fixableFindings.length} fix(es)?`,
      });
      if (p.isCancel(confirm)) {
        p.log.info("Fixes cancelled.");
      } else {
        approved = confirm;
      }
    }

    if (approved) {
      const filesFixed = applyFixContent(fixContent, root);
      if (filesFixed === 0) {
        p.log.info("No files were modified (could not parse fix output).");
      }
    }
  } catch (fixErr) {
    fixSpinner.stop("Fix generation failed.");
    p.log.error(`Fix failed: ${fixErr instanceof Error ? fixErr.message : String(fixErr)}`);
  }
}

function makeCheckAuditEntry(status: "success" | "failure", durationMs: number) {
  return {
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
    command: "check",
    action: "devops-check",
    status,
    durationMs,
  } as const;
}

export const checkCommand: CommandHandler = async (_args, cliCtx) => {
  if (_args[0] === "provider") {
    return checkProviderCommand(_args.slice(1), cliCtx);
  }

  const fixMode = hasFlag(_args, "--fix");
  const autoApprove = hasFlag(_args, "--yes") || cliCtx.globalOpts.nonInteractive;

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

  const fileContents = readDevopsFiles(root, ctx.devopsFiles);
  if (fileContents.length === 0) {
    p.log.warn("Could not read any DevOps files. Nothing to check.");
    return;
  }

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rootPath: _rp, ...contextForLLM } = ctx;
  const contextJson = JSON.stringify(contextForLLM, null, 2);

  try {
    const report = await checker.check(contextJson, fileContents);
    if (!isStructured) s.stop("Analysis complete.");
    const durationMs = Date.now() - start;

    if (cliCtx.globalOpts.output === "json") {
      console.log(JSON.stringify(report, null, 2));
      appendAudit(root, makeCheckAuditEntry("success", durationMs));
      return;
    }

    const { color: scoreColor, label: scoreLabel } = getScoreStyle(report.score);
    p.note(
      wrapForNote(
        [
          `${pc.bold("Score:")} ${scoreColor(report.score + "/100")} ${pc.dim("(" + scoreLabel + ")")}`,
          "",
          report.summary,
        ].join("\n"),
      ),
      "DevOps Maturity",
    );

    renderFindings(report.findings);

    if (report.missingFiles.length > 0) {
      const missingLines = report.missingFiles.map((f) => `  ${pc.yellow("○")} ${f}`);
      p.note(wrapForNote(missingLines.join("\n")), "Recommended missing files");
    }

    if (fixMode && report.findings.length > 0) {
      await handleFixMode(report, fileContents, provider, root, autoApprove);
    }

    appendAudit(root, makeCheckAuditEntry("success", durationMs));
  } catch (err) {
    if (!isStructured) s.stop("Analysis failed.");
    appendAudit(root, makeCheckAuditEntry("failure", Date.now() - start));
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Check failed: ${toErrorMessage(err)}`);
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
          error: toErrorMessage(err),
        }),
      );
      return;
    }

    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Provider ${provider.name} connectivity check failed: ${toErrorMessage(err)}`,
    );
  }
}
