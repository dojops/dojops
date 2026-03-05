import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ScannerResult, ScanFinding } from "../types";
import { discoverProjectDirs } from "../discovery";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";

interface NpmVulnerability {
  severity: string;
  via: Array<string | { title?: string; url?: string }>;
  fixAvailable: boolean | { name: string; version: string };
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmVulnerability>;
}

type PackageManager = "npm" | "yarn" | "pnpm";

/**
 * Detect which package manager is used in a directory.
 * Priority: pnpm-lock.yaml > yarn.lock > package-lock.json
 */
function detectPackageManager(dir: string): PackageManager | null {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";
  return null;
}

export async function scanNpm(projectPath: string): Promise<ScannerResult> {
  const projectDirs = discoverProjectDirs(projectPath, [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ]);

  // FEAT #2: If no lockfile exists but package.json does, generate a temporary lockfile
  if (projectDirs.length === 0) {
    const pkgJsonDirs = discoverProjectDirs(projectPath, ["package.json"]);
    if (pkgJsonDirs.length === 0) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: "No package.json or lockfile found",
      };
    }

    // Try generating a temporary lockfile in a temp directory
    const tmpDirs: string[] = [];
    for (const dir of pkgJsonDirs) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-audit-"));
      try {
        fs.copyFileSync(path.join(dir, "package.json"), path.join(tmpDir, "package.json"));
        await execFileAsync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
          encoding: "utf-8",
          timeout: 60_000,
          cwd: tmpDir,
        });
        tmpDirs.push(tmpDir);
      } catch {
        // Clean up on failure
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failure
        }
      }
    }

    if (tmpDirs.length === 0) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: "No lockfile found and failed to generate temporary lockfile for audit",
      };
    }

    // Audit the temporary directories, then clean them up
    const allFindings: ScanFinding[] = [];
    let combinedRawOutput = "";
    for (const tmpDir of tmpDirs) {
      try {
        const result = await auditDir(tmpDir, projectPath, "npm");
        if (!result.skipped) {
          allFindings.push(...result.findings);
          if (result.rawOutput) combinedRawOutput += result.rawOutput + "\n";
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup failure
        }
      }
    }
    return {
      tool: "npm-audit",
      findings: allFindings,
      rawOutput: combinedRawOutput || undefined,
    };
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const dir of projectDirs) {
    const pm = detectPackageManager(dir);
    if (!pm) continue;

    const result = await auditDir(dir, projectPath, pm);
    if (result.skipped) {
      // If the tool itself isn't found, bail out entirely
      if (result.skipReason?.endsWith("not found")) {
        return result;
      }
      continue;
    }
    allFindings.push(...result.findings);
    if (result.rawOutput) combinedRawOutput += result.rawOutput + "\n";
  }

  return { tool: "npm-audit", findings: allFindings, rawOutput: combinedRawOutput || undefined };
}

async function auditDir(dir: string, rootPath: string, pm: PackageManager): Promise<ScannerResult> {
  const subProject = dir === rootPath ? undefined : path.relative(rootPath, dir);

  let rawOutput: string;
  try {
    const { cmd, args } = getAuditCommand(pm);
    const result = await execFileAsync(cmd, args, {
      encoding: "utf-8",
      timeout: 60_000,
      cwd: dir,
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: `${pm} not found`,
      };
    }
    // audit commands exit non-zero when vulnerabilities are found but still output JSON
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: `${pm} audit failed${subProject ? " (" + subProject + ")" : ""}: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];
  const lockFile = getLockFile(pm);

  try {
    switch (pm) {
      case "npm":
        parseNpmAudit(rawOutput, findings, subProject, lockFile);
        break;
      case "yarn":
        parseYarnAudit(rawOutput, findings, subProject, lockFile);
        break;
      case "pnpm":
        parsePnpmAudit(rawOutput, findings, subProject, lockFile);
        break;
    }
  } catch {
    findings.push({
      id: `${pm}-audit-parse-error`,
      tool: "npm-audit",
      severity: "MEDIUM",
      category: "SECURITY",
      message: `Failed to parse ${pm} audit output. The tool may have produced unexpected output format.`,
      autoFixAvailable: false,
    });
  }

  return { tool: "npm-audit", findings, rawOutput };
}

function getAuditCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "yarn":
      return { cmd: "yarn", args: ["audit", "--json"] };
    case "pnpm":
      return { cmd: "pnpm", args: ["audit", "--json"] };
    case "npm":
    default:
      return { cmd: "npm", args: ["audit", "--json"] };
  }
}

function getLockFile(pm: PackageManager): string {
  switch (pm) {
    case "yarn":
      return "yarn.lock";
    case "pnpm":
      return "pnpm-lock.yaml";
    case "npm":
    default:
      return "package-lock.json";
  }
}

function parseNpmAudit(
  rawOutput: string,
  findings: ScanFinding[],
  subProject: string | undefined,
  lockFile: string,
): void {
  const audit: NpmAuditOutput = JSON.parse(rawOutput);
  if (audit.vulnerabilities) {
    for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
      const severity = mapSeverity(vuln.severity);
      const viaMessages = vuln.via
        .map((v) => (typeof v === "string" ? v : (v.title ?? "")))
        .filter(Boolean)
        .join("; ");

      const prefix = subProject ? `${subProject}: ` : "";
      findings.push({
        id: deterministicFindingId("npm", name, severity),
        tool: "npm-audit",
        severity,
        category: "DEPENDENCY",
        file: subProject ? `${subProject}/${lockFile}` : lockFile,
        message: `${prefix}${name}: ${viaMessages || vuln.severity} vulnerability`,
        recommendation: vuln.fixAvailable
          ? (typeof vuln.fixAvailable === "object"
            ? `Update to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
            : "Run npm audit fix")
          : "No automatic fix available — review manually",
        autoFixAvailable: !!vuln.fixAvailable,
      });
    }
  }
}

/**
 * Parse yarn audit JSON output.
 * Yarn classic outputs NDJSON (one JSON object per line) with type "auditAdvisory".
 */
function parseYarnAudit(
  rawOutput: string,
  findings: ScanFinding[],
  subProject: string | undefined,
  lockFile: string,
): void {
  const lines = rawOutput.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "auditAdvisory" || !entry.data?.advisory) continue;
      const advisory = entry.data.advisory;
      const prefix = subProject ? `${subProject}: ` : "";
      findings.push({
        id: deterministicFindingId("yarn", advisory.module_name ?? "", advisory.severity ?? ""),
        tool: "npm-audit",
        severity: mapSeverity(advisory.severity ?? "moderate"),
        category: "DEPENDENCY",
        file: subProject ? `${subProject}/${lockFile}` : lockFile,
        message: `${prefix}${String(advisory.module_name)}: ${String(advisory.title ?? advisory.severity ?? "vulnerability")}`,
        recommendation: advisory.patched_versions
          ? `Update to ${String(advisory.module_name)}@${String(advisory.patched_versions)}`
          : "No automatic fix available — review manually",
        autoFixAvailable: !!advisory.patched_versions,
        cve: advisory.cves?.[0] || undefined,
      });
    } catch {
      // Skip unparseable lines (e.g., summary lines)
    }
  }
}

/**
 * Parse pnpm audit JSON output.
 * pnpm audit --json outputs a structure similar to npm: { advisories: { [id]: advisory } }
 */
function parsePnpmAudit(
  rawOutput: string,
  findings: ScanFinding[],
  subProject: string | undefined,
  lockFile: string,
): void {
  const audit = JSON.parse(rawOutput);
  // pnpm audit may use `advisories` (older) or `vulnerabilities` (newer, npm-compatible)
  const advisories: Record<string, unknown> = audit.advisories ?? {};
  for (const advisory of Object.values(advisories) as Array<Record<string, unknown>>) {
    const prefix = subProject ? `${subProject}: ` : "";
    const moduleName = String(advisory.module_name ?? advisory.name ?? "unknown");
    const severity = mapSeverity(String(advisory.severity ?? "moderate"));
    const title = String(advisory.title ?? advisory.overview ?? "vulnerability");
    const patchedVersions = advisory.patched_versions
      ? String(advisory.patched_versions)
      : undefined;
    const cves = Array.isArray(advisory.cves) ? advisory.cves : [];

    findings.push({
      id: deterministicFindingId("pnpm", moduleName, severity),
      tool: "npm-audit",
      severity,
      category: "DEPENDENCY",
      file: subProject ? `${subProject}/${lockFile}` : lockFile,
      message: `${prefix}${moduleName}: ${title}`,
      recommendation: patchedVersions
        ? `Update to ${moduleName}@${patchedVersions}`
        : "No automatic fix available — review manually",
      autoFixAvailable: !!patchedVersions,
      cve: cves[0] ? String(cves[0]) : undefined,
    });
  }

  // Also try npm-compatible vulnerabilities format
  if (audit.vulnerabilities && !audit.advisories) {
    parseNpmAudit(rawOutput, findings, subProject, lockFile);
  }
}

function mapSeverity(severity: string): ScanFinding["severity"] {
  switch (severity) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "moderate":
      return "MEDIUM";
    case "low":
    case "info":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
