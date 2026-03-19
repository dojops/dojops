import { execFileSync } from "node:child_process";
import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot, appendAudit, getCurrentUser } from "../state";

interface FixResult {
  tool: string;
  beforeCount: number;
  afterCount: number;
  fixed: number;
  details: string[];
}

// ── npm / pnpm fix ────────────────────────────────────────────────

function detectPackageManager(): "pnpm" | "npm" | null {
  if (fs.existsSync("pnpm-lock.yaml")) return "pnpm";
  if (fs.existsSync("package-lock.json") || fs.existsSync("package.json")) return "npm";
  return null;
}

function countNpmVulnerabilities(pm: "npm" | "pnpm"): number {
  try {
    if (pm === "pnpm") {
      const result = execFileSync("pnpm", ["audit", "--json"], {
        stdio: "pipe",
        timeout: 60_000,
      });
      const data = JSON.parse(result.toString("utf-8"));
      return data.metadata?.vulnerabilities
        ? Object.values(data.metadata.vulnerabilities as Record<string, number>).reduce(
            (sum: number, n: unknown) => sum + (typeof n === "number" ? n : 0),
            0,
          )
        : 0;
    }
    const result = execFileSync("npm", ["audit", "--json"], {
      stdio: "pipe",
      timeout: 60_000,
    });
    const data = JSON.parse(result.toString("utf-8"));
    return data.metadata?.vulnerabilities
      ? Object.values(data.metadata.vulnerabilities as Record<string, number>).reduce(
          (sum: number, n: unknown) => sum + (typeof n === "number" ? n : 0),
          0,
        )
      : 0;
  } catch (err: unknown) {
    // npm audit exits non-zero when vulnerabilities exist but still outputs JSON
    const execErr = err as { stdout?: Buffer };
    if (execErr.stdout) {
      try {
        const data = JSON.parse(execErr.stdout.toString("utf-8"));
        return data.metadata?.vulnerabilities
          ? Object.values(data.metadata.vulnerabilities as Record<string, number>).reduce(
              (sum: number, n: unknown) => sum + (typeof n === "number" ? n : 0),
              0,
            )
          : 0;
      } catch {
        // ignore parse error
      }
    }
    return 0;
  }
}

function runNpmFix(pm: "npm" | "pnpm", dryRun: boolean): string[] {
  const details: string[] = [];

  if (pm === "npm") {
    const args = ["audit", "fix"];
    if (dryRun) args.push("--dry-run");

    try {
      const result = execFileSync("npm", args, { stdio: "pipe", timeout: 120_000 });
      const output = result.toString("utf-8");
      if (output.trim()) {
        details.push(...output.trim().split("\n").slice(0, 10));
      }
    } catch (err: unknown) {
      const execErr = err as { stdout?: Buffer };
      if (execErr.stdout) {
        const output = execErr.stdout.toString("utf-8");
        if (output.trim()) {
          details.push(...output.trim().split("\n").slice(0, 10));
        }
      }
    }
  } else {
    // pnpm doesn't have a built-in audit fix, so we run npm audit fix in a compatibility mode
    p.log.warn(
      "pnpm does not have a native fix command. Running npm audit fix which may conflict with pnpm-lock.yaml. Consider running 'pnpm update' manually instead.",
    );
    if (dryRun) {
      details.push("pnpm does not support --fix natively. Would run: npm audit fix");
    } else {
      try {
        const result = execFileSync("npm", ["audit", "fix"], {
          stdio: "pipe",
          timeout: 120_000,
        });
        const output = result.toString("utf-8");
        if (output.trim()) {
          details.push(...output.trim().split("\n").slice(0, 10));
        }
      } catch (err: unknown) {
        const execErr = err as { stdout?: Buffer };
        if (execErr.stdout) {
          const output = execErr.stdout.toString("utf-8");
          if (output.trim()) {
            details.push(...output.trim().split("\n").slice(0, 10));
          }
        }
      }
    }
  }

  return details;
}

// ── pip fix ───────────────────────────────────────────────────────

function isPipAuditInstalled(): boolean {
  try {
    execFileSync("pip-audit", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function countPipVulnerabilities(): number {
  try {
    const result = execFileSync("pip-audit", ["--format", "json"], {
      stdio: "pipe",
      timeout: 120_000,
    });
    const data = JSON.parse(result.toString("utf-8")) as unknown[];
    return Array.isArray(data) ? data.length : 0;
  } catch (err: unknown) {
    const execErr = err as { stdout?: Buffer };
    if (execErr.stdout) {
      try {
        const data = JSON.parse(execErr.stdout.toString("utf-8")) as unknown[];
        return Array.isArray(data) ? data.length : 0;
      } catch {
        // ignore
      }
    }
    return 0;
  }
}

function runPipFix(dryRun: boolean): string[] {
  const details: string[] = [];
  const args = ["--fix"];
  if (dryRun) args.push("--dry-run");

  try {
    const result = execFileSync("pip-audit", args, { stdio: "pipe", timeout: 120_000 });
    const output = result.toString("utf-8");
    if (output.trim()) {
      details.push(...output.trim().split("\n").slice(0, 10));
    }
  } catch (err: unknown) {
    const execErr = err as { stdout?: Buffer };
    if (execErr.stdout) {
      const output = execErr.stdout.toString("utf-8");
      if (output.trim()) {
        details.push(...output.trim().split("\n").slice(0, 10));
      }
    }
  }

  return details;
}

// ── Display ───────────────────────────────────────────────────────

function displayFixResult(result: FixResult): void {
  const lines: string[] = [];
  lines.push(`${pc.bold("Tool:")}     ${result.tool}`);
  lines.push(`${pc.bold("Before:")}   ${result.beforeCount} vulnerabilities`);
  lines.push(`${pc.bold("After:")}    ${result.afterCount} vulnerabilities`);
  lines.push(
    `${pc.bold("Fixed:")}    ${result.fixed > 0 ? pc.green(String(result.fixed)) : pc.dim("0")}`,
  );

  if (result.details.length > 0) {
    lines.push("");
    for (const detail of result.details) {
      lines.push(`  ${pc.dim(detail)}`);
    }
  }

  p.note(lines.join("\n"), `Fix Results: ${result.tool}`);
}

// ── Main command ──────────────────────────────────────────────────

export async function fixDepsCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  const useNpm = hasFlag(args, "--npm");
  const usePip = hasFlag(args, "--pip");
  const dryRun = hasFlag(args, "--dry-run") || ctx.globalOpts.dryRun;
  const detectBoth = !useNpm && !usePip;

  const results: FixResult[] = [];

  if (dryRun && !ctx.globalOpts.quiet) {
    p.log.info(pc.yellow("Dry-run mode: no changes will be applied."));
  }

  // npm / pnpm fix
  if (useNpm || detectBoth) {
    const pm = detectPackageManager();
    if (pm) {
      const spinner = p.spinner();
      if (ctx.globalOpts.output !== "json") spinner.start(`Scanning ${pm} dependencies...`);

      const beforeCount = countNpmVulnerabilities(pm);
      if (beforeCount === 0) {
        if (ctx.globalOpts.output !== "json") spinner.stop(`No ${pm} vulnerabilities found`);
      } else {
        if (ctx.globalOpts.output !== "json")
          spinner.start(`Fixing ${pm} dependencies (${beforeCount} vulnerabilities)...`);
        const details = runNpmFix(pm, dryRun);
        const afterCount = dryRun ? beforeCount : countNpmVulnerabilities(pm);
        if (ctx.globalOpts.output !== "json") spinner.stop(`${pm} fix complete`);

        results.push({
          tool: pm,
          beforeCount,
          afterCount,
          fixed: beforeCount - afterCount,
          details,
        });
      }
    } else if (!detectBoth) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, "No package.json or pnpm-lock.yaml found.");
    }
  }

  // pip fix
  if (usePip || detectBoth) {
    if (isPipAuditInstalled()) {
      const spinner = p.spinner();
      if (ctx.globalOpts.output !== "json") spinner.start("Scanning pip dependencies...");

      const beforeCount = countPipVulnerabilities();
      if (beforeCount === 0) {
        if (ctx.globalOpts.output !== "json") spinner.stop("No pip vulnerabilities found");
      } else {
        if (ctx.globalOpts.output !== "json")
          spinner.start(`Fixing pip dependencies (${beforeCount} vulnerabilities)...`);
        const details = runPipFix(dryRun);
        const afterCount = dryRun ? beforeCount : countPipVulnerabilities();
        if (ctx.globalOpts.output !== "json") spinner.stop("pip fix complete");

        results.push({
          tool: "pip-audit",
          beforeCount,
          afterCount,
          fixed: beforeCount - afterCount,
          details,
        });
      }
    } else if (usePip) {
      p.note(
        [
          `${pc.bold(pc.yellow("pip-audit is not installed."))}`,
          "",
          `Install: ${pc.cyan("pip install pip-audit")}`,
        ].join("\n"),
        "Install Required",
      );
      throw new CLIError(ExitCode.GENERAL_ERROR, "pip-audit is not installed.");
    }
  }

  if (results.length === 0) {
    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify([], null, 2));
    } else {
      p.log.info("No dependency vulnerabilities to fix.");
    }
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      displayFixResult(result);
    }
  }

  const root = findProjectRoot();
  if (root) {
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: "fix-deps",
      action: dryRun ? "dry-run" : "fix",
      status: "success",
      durationMs: Date.now() - startTime,
    });
  }
}
