import * as fs from "node:fs";
import * as path from "node:path";
import { ScannerResult, ScanFinding } from "../types";
import { listSubDirs } from "../discovery";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";
import { isENOENT, mapLintLevel, parseErrorFinding, skippedResult } from "../scanner-utils";

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
    return skippedResult("hadolint", "No Dockerfile found");
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const dockerfile of dockerfiles) {
    let rawOutput: string;
    try {
      const result = await execFileAsync("hadolint", ["--format", "json", dockerfile], {
        encoding: "utf-8",
        timeout: 30_000,
      });
      rawOutput = result.stdout;
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return skippedResult("hadolint", "hadolint not found");
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
          id: deterministicFindingId("hadolint", r.code, relPath, String(r.line)),
          tool: "hadolint",
          severity: mapLintLevel(r.level),
          category: "SECURITY",
          file: relPath,
          line: r.line,
          message: `${r.code}: ${r.message}`,
          recommendation: `Fix ${r.code} in ${relPath}:${r.line}`,
          autoFixAvailable: false,
        });
      }
    } catch {
      allFindings.push(parseErrorFinding("hadolint", "SECURITY"));
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
