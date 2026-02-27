import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding, ScanSeverity } from "../types";
import { listSubDirs } from "../discovery";
import { execFileAsync } from "../exec-async";

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

/**
 * Check if a binary at the given path is a Node.js/npm script wrapper
 * (not a real binary). Reads the first line and checks for node shebang.
 */
function isNodeWrapper(binPath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(binPath, "r");
    const buf = Buffer.alloc(128);
    fs.readSync(fd, buf, 0, 128, 0);
    const head = buf.toString("utf-8").split("\n")[0];
    return /node|env\s+node/.test(head);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Resolve the shellcheck binary path.
 * Priority: sandbox (~/.dojops/tools/bin) → well-known system paths → PATH fallback.
 * Skips Node.js/npm wrapper scripts to avoid running the wrong binary.
 */
function resolveShellcheck(): string {
  // 1. Sandbox install
  const sandboxBin = path.join(os.homedir(), ".dojops", "tools", "bin", "shellcheck");
  if (fs.existsSync(sandboxBin) && !isNodeWrapper(sandboxBin)) return sandboxBin;

  // 2. Well-known system paths (avoids npm wrapper issues)
  const systemPaths = ["/usr/bin/shellcheck", "/usr/local/bin/shellcheck"];
  for (const sp of systemPaths) {
    if (fs.existsSync(sp) && !isNodeWrapper(sp)) return sp;
  }

  // 3. Fall back to bare name (resolved via PATH)
  return "shellcheck";
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

  const shellcheckBin = resolveShellcheck();
  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const script of scripts) {
    let rawOutput: string;
    try {
      const result = await execFileAsync(shellcheckBin, ["--format", "json", script], {
        encoding: "utf-8",
        timeout: 30_000,
      });
      rawOutput = result.stdout;
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
      allFindings.push({
        id: "shellcheck-parse-error",
        tool: "shellcheck",
        severity: "MEDIUM",
        category: "IAC",
        message:
          "Failed to parse shellcheck output. The tool may have produced unexpected output format.",
        autoFixAvailable: false,
      });
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

  function hasShellShebang(filePath: string): boolean {
    let fd: number | undefined;
    try {
      fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(64);
      fs.readSync(fd, buf, 0, 64, 0);
      const head = buf.toString("utf-8");
      return /^#!\s*\/(?:usr\/)?(?:bin\/(?:env\s+)?)?(?:ba)?sh\b/.test(head);
    } catch {
      return false;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function scanDir(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.name.endsWith(".sh") || entry.name.endsWith(".bash")) {
          addScript(fullPath);
        } else if (!entry.name.includes(".") && hasShellShebang(fullPath)) {
          addScript(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // Directories to scan for shell scripts
  const scanDirs = ["scripts", "bin", "ci", path.join(".github", "scripts"), "hack"];

  // Scan root
  scanDir(projectPath);

  // Scan well-known script directories
  for (const dir of scanDirs) {
    const dirPath = path.join(projectPath, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      scanDir(dirPath);
    }
  }

  // Scan sub-project directories
  for (const child of listSubDirs(projectPath)) {
    const childPath = path.join(projectPath, child);
    scanDir(childPath);

    for (const dir of scanDirs) {
      const childDirPath = path.join(childPath, dir);
      if (fs.existsSync(childDirPath) && fs.statSync(childDirPath).isDirectory()) {
        scanDir(childDirPath);
      }
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
