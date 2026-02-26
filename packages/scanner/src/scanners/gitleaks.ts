import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding } from "../types";

interface GitleaksResult {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  EndLine: number;
  StartColumn?: number;
  EndColumn?: number;
  Match?: string;
  Secret?: string;
  Entropy?: number;
}

export async function scanGitleaks(projectPath: string): Promise<ScannerResult> {
  // Use a temp file for the report — /dev/stdout is unavailable in some environments (WSL2, sandboxes)
  const reportFile = path.join(os.tmpdir(), `gitleaks-${crypto.randomUUID().slice(0, 8)}.json`);
  let rawOutput: string;
  try {
    execFileSync(
      "gitleaks",
      [
        "detect",
        "--source",
        projectPath,
        "--report-format",
        "json",
        "--report-path",
        reportFile,
        "--no-git",
      ],
      {
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
      },
    );
    rawOutput = readAndCleanup(reportFile);
  } catch (err: unknown) {
    if (isENOENT(err)) {
      cleanup(reportFile);
      return {
        tool: "gitleaks",
        findings: [],
        skipped: true,
        skipReason: "gitleaks not found",
      };
    }
    // gitleaks exits with code 1 when leaks are found
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    rawOutput = readAndCleanup(reportFile);
    if (!rawOutput) {
      // Exit code 1 with no stdout means no leaks (or error)
      if (execErr.status === 1 && !execErr.stderr) {
        return { tool: "gitleaks", findings: [] };
      }
      return {
        tool: "gitleaks",
        findings: [],
        skipped: true,
        skipReason: `gitleaks failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const results: GitleaksResult[] = JSON.parse(rawOutput);
    for (const leak of results) {
      findings.push({
        id: `gitleaks-${crypto.randomUUID().slice(0, 8)}`,
        tool: "gitleaks",
        severity: "CRITICAL",
        category: "SECRETS",
        file: leak.File,
        line: leak.StartLine,
        message: `${leak.RuleID}: ${leak.Description}`,
        recommendation: "Remove secret from source code and rotate the credential immediately",
        autoFixAvailable: false,
      });
    }
  } catch {
    // Only add parse warning if there was actual output to parse (not empty/no leaks)
    if (rawOutput && rawOutput.trim().length > 0) {
      findings.push({
        id: "gitleaks-parse-error",
        tool: "gitleaks",
        severity: "LOW",
        category: "SECRETS",
        message:
          "Failed to parse gitleaks output. The tool may have produced unexpected output format.",
        autoFixAvailable: false,
      });
    }
  }

  return { tool: "gitleaks", findings, rawOutput };
}

function readAndCleanup(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  } finally {
    cleanup(filePath);
  }
}

function cleanup(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
