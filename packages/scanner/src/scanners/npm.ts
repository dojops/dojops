import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding } from "../types";
import { discoverProjectDirs } from "../discovery";

interface NpmVulnerability {
  severity: string;
  via: Array<string | { title?: string; url?: string }>;
  fixAvailable: boolean | { name: string; version: string };
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, NpmVulnerability>;
}

export async function scanNpm(projectPath: string): Promise<ScannerResult> {
  const projectDirs = discoverProjectDirs(projectPath, ["package-lock.json"]);
  if (projectDirs.length === 0) {
    return {
      tool: "npm-audit",
      findings: [],
      skipped: true,
      skipReason: "No package-lock.json found",
    };
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const dir of projectDirs) {
    const result = await auditDir(dir, projectPath);
    if (result.skipped) {
      // If npm itself isn't found, bail out entirely
      if (result.skipReason === "npm not found") {
        return result;
      }
      continue;
    }
    allFindings.push(...result.findings);
    if (result.rawOutput) combinedRawOutput += result.rawOutput + "\n";
  }

  return { tool: "npm-audit", findings: allFindings, rawOutput: combinedRawOutput || undefined };
}

async function auditDir(dir: string, rootPath: string): Promise<ScannerResult> {
  const subProject = dir === rootPath ? undefined : path.relative(rootPath, dir);

  let rawOutput: string;
  try {
    rawOutput = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
      cwd: dir,
    });
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: "npm not found",
      };
    }
    // npm audit exits non-zero when vulnerabilities are found but still outputs JSON
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "npm-audit",
        findings: [],
        skipped: true,
        skipReason: `npm audit failed${subProject ? ` (${subProject})` : ""}: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
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
          id: `npm-${crypto.randomUUID().slice(0, 8)}`,
          tool: "npm-audit",
          severity,
          category: "DEPENDENCY",
          file: subProject ? `${subProject}/package-lock.json` : "package-lock.json",
          message: `${prefix}${name}: ${viaMessages || vuln.severity} vulnerability`,
          recommendation: vuln.fixAvailable
            ? typeof vuln.fixAvailable === "object"
              ? `Update to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
              : "Run npm audit fix"
            : "No automatic fix available — review manually",
          autoFixAvailable: !!vuln.fixAvailable,
        });
      }
    }
  } catch {
    findings.push({
      id: "npm-audit-parse-error",
      tool: "npm-audit",
      severity: "LOW",
      category: "SECURITY",
      message:
        "Failed to parse npm-audit output. The tool may have produced unexpected output format.",
      autoFixAvailable: false,
    });
  }

  return { tool: "npm-audit", findings, rawOutput };
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
