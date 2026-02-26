import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding, ScanSeverity } from "../types";
import { listSubDirs } from "../discovery";

interface HadolintResult {
  line: number;
  code: string;
  message: string;
  column: number;
  file: string;
  level: string;
}

export async function scanHadolint(projectPath: string): Promise<ScannerResult> {
  // Find Dockerfiles
  const dockerfiles = findDockerfiles(projectPath);
  if (dockerfiles.length === 0) {
    return {
      tool: "hadolint",
      findings: [],
      skipped: true,
      skipReason: "No Dockerfile found",
    };
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const dockerfile of dockerfiles) {
    let rawOutput: string;
    try {
      rawOutput = execFileSync("hadolint", ["--format", "json", dockerfile], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          tool: "hadolint",
          findings: [],
          skipped: true,
          skipReason: "hadolint not found",
        };
      }
      // hadolint exits non-zero when issues found, but still outputs JSON
      const execErr = err as { stdout?: string; stderr?: string };
      rawOutput = execErr.stdout ?? "";
      if (!rawOutput) {
        continue;
      }
    }

    combinedRawOutput += rawOutput + "\n";

    try {
      const results: HadolintResult[] = JSON.parse(rawOutput);
      const relPath = path.relative(projectPath, dockerfile);

      for (const r of results) {
        allFindings.push({
          id: `hadolint-${crypto.randomUUID().slice(0, 8)}`,
          tool: "hadolint",
          severity: mapLevel(r.level),
          category: "SECURITY",
          file: relPath,
          line: r.line,
          message: `${r.code}: ${r.message}`,
          recommendation: `Fix ${r.code} in ${relPath}:${r.line}`,
          autoFixAvailable: false,
        });
      }
    } catch {
      allFindings.push({
        id: "hadolint-parse-error",
        tool: "hadolint",
        severity: "LOW",
        category: "SECURITY",
        message:
          "Failed to parse hadolint output. The tool may have produced unexpected output format.",
        autoFixAvailable: false,
      });
    }
  }

  return { tool: "hadolint", findings: allFindings, rawOutput: combinedRawOutput };
}

function findDockerfiles(projectPath: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  function addDockerfile(filePath: string): void {
    if (!seen.has(filePath)) {
      seen.add(filePath);
      results.push(filePath);
    }
  }

  // Explicit root check (works even when readdirSync is unavailable)
  const rootDockerfile = path.join(projectPath, "Dockerfile");
  if (fs.existsSync(rootDockerfile)) {
    addDockerfile(rootDockerfile);
  }

  // Check common locations at root level
  const commonLocations = ["docker", "build", ".docker"];
  for (const loc of commonLocations) {
    const dir = path.join(projectPath, loc);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      checkDirForDockerfiles(dir, addDockerfile);
    }
  }

  // Check sub-project directories (level 1 + level 2)
  for (const child of listSubDirs(projectPath)) {
    const childPath = path.join(projectPath, child);

    // Explicit Dockerfile check in sub-project
    const childDockerfile = path.join(childPath, "Dockerfile");
    if (fs.existsSync(childDockerfile)) {
      addDockerfile(childDockerfile);
    }

    // Check common locations inside sub-projects
    for (const loc of commonLocations) {
      const subDir = path.join(childPath, loc);
      if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
        checkDirForDockerfiles(subDir, addDockerfile);
      }
    }

    // Check level 2 children (packages/app/)
    for (const grandchild of listSubDirs(childPath)) {
      const gcPath = path.join(childPath, grandchild);
      const gcDockerfile = path.join(gcPath, "Dockerfile");
      if (fs.existsSync(gcDockerfile)) {
        addDockerfile(gcDockerfile);
      }
    }
  }

  return results;
}

function checkDirForDockerfiles(dir: string, add: (filePath: string) => void): void {
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry === "Dockerfile" || entry.startsWith("Dockerfile.")) {
        add(path.join(dir, entry));
      }
    }
  } catch {
    // Skip unreadable directories
  }
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
