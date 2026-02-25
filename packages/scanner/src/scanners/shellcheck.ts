import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding, ScanSeverity } from "../types";
import { listSubDirs } from "../discovery";

interface ShellCheckResult {
  file: string;
  line: number;
  endLine?: number;
  column: number;
  endColumn?: number;
  level: string;
  code: number;
  message: string;
  fix?: { replacements: unknown[] };
}

export async function scanShellcheck(projectPath: string): Promise<ScannerResult> {
  const scripts = findShellScripts(projectPath);
  if (scripts.length === 0) {
    return {
      tool: "shellcheck",
      findings: [],
      skipped: true,
      skipReason: "No shell scripts found",
    };
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const script of scripts) {
    let rawOutput: string;
    try {
      rawOutput = execFileSync("shellcheck", ["--format", "json", script], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          tool: "shellcheck",
          findings: [],
          skipped: true,
          skipReason: "shellcheck not found",
        };
      }
      // shellcheck exits non-zero when issues found, but still outputs JSON
      const execErr = err as { stdout?: string; stderr?: string };
      rawOutput = execErr.stdout ?? "";
      if (!rawOutput) {
        continue;
      }
    }

    combinedRawOutput += rawOutput + "\n";

    try {
      const results: ShellCheckResult[] = JSON.parse(rawOutput);
      const relPath = path.relative(projectPath, script);

      for (const r of results) {
        allFindings.push({
          id: `shellcheck-${crypto.randomUUID().slice(0, 8)}`,
          tool: "shellcheck",
          severity: mapLevel(r.level),
          category: "IAC",
          file: relPath,
          line: r.line,
          message: `SC${r.code}: ${r.message}`,
          recommendation: `Fix SC${r.code} in ${relPath}:${r.line}`,
          autoFixAvailable: !!r.fix,
        });
      }
    } catch {
      // JSON parse failed
    }
  }

  return { tool: "shellcheck", findings: allFindings, rawOutput: combinedRawOutput };
}

function findShellScripts(projectPath: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  function addScript(filePath: string): void {
    if (!seen.has(filePath)) {
      seen.add(filePath);
      results.push(filePath);
    }
  }

  function scanDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith(".sh") || entry.endsWith(".bash")) {
          addScript(path.join(dir, entry));
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Scan root
  scanDir(projectPath);

  // Scan scripts/ directory
  const scriptsDir = path.join(projectPath, "scripts");
  if (fs.existsSync(scriptsDir) && fs.statSync(scriptsDir).isDirectory()) {
    scanDir(scriptsDir);
  }

  // Scan sub-project directories
  for (const child of listSubDirs(projectPath)) {
    const childPath = path.join(projectPath, child);
    scanDir(childPath);

    // Check scripts/ inside sub-projects
    const childScriptsDir = path.join(childPath, "scripts");
    if (fs.existsSync(childScriptsDir) && fs.statSync(childScriptsDir).isDirectory()) {
      scanDir(childScriptsDir);
    }
  }

  return results;
}

function mapLevel(level: string): ScanSeverity {
  switch (level) {
    case "error":
      return "HIGH";
    case "warning":
      return "MEDIUM";
    case "info":
    case "style":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
