import * as fs from "node:fs";
import * as path from "node:path";
import { ScannerResult, ScanFinding } from "../types";
import { discoverProjectDirs } from "../discovery";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";

const PIP_INDICATORS = ["requirements.txt", "Pipfile", "setup.py", "pyproject.toml"];

interface PipAuditPackage {
  name: string;
  version: string;
  vulns: PipAuditVuln[];
}

interface PipAuditVuln {
  id: string;
  fix_versions?: string[];
  description?: string;
  aliases?: string[];
}

function mapPipSeverity(id: string, description?: string): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  const desc = (description ?? "").toLowerCase();
  id = id.toLowerCase();
  // CVE-based heuristic: critical keywords → CRITICAL, otherwise HIGH for known vulns
  if (
    desc.includes("remote code execution") ||
    desc.includes("rce") ||
    desc.includes("arbitrary code")
  ) {
    return "CRITICAL";
  }
  if (desc.includes("denial of service") || desc.includes("dos")) {
    return "MEDIUM";
  }
  if (desc.includes("information disclosure") || desc.includes("information leak")) {
    return "MEDIUM";
  }
  // PYSEC and GHSA are known vulnerability databases — default to HIGH
  if (id.startsWith("pysec-") || id.startsWith("ghsa-")) {
    return "HIGH";
  }
  return "HIGH";
}

function getPipFindingFile(
  subProject: string | null | undefined,
  hasRequirements: boolean,
): string {
  const filename = hasRequirements ? "requirements.txt" : "pyproject.toml";
  if (subProject) {
    return `${subProject}/${filename}`;
  }
  return filename;
}

export async function scanPip(projectPath: string): Promise<ScannerResult> {
  const projectDirs = discoverProjectDirs(projectPath, PIP_INDICATORS);
  if (projectDirs.length === 0) {
    return {
      tool: "pip-audit",
      findings: [],
      skipped: true,
      skipReason: "No Python dependency file found",
    };
  }

  const allFindings: ScanFinding[] = [];
  let combinedRawOutput = "";

  for (const dir of projectDirs) {
    const result = await auditDir(dir, projectPath);
    if (result.skipped) {
      if (result.skipReason === "pip-audit not found") {
        return result;
      }
      continue;
    }
    allFindings.push(...result.findings);
    if (result.rawOutput) combinedRawOutput += result.rawOutput + "\n";
  }

  return { tool: "pip-audit", findings: allFindings, rawOutput: combinedRawOutput || undefined };
}

async function auditDir(dir: string, rootPath: string): Promise<ScannerResult> {
  const subProject = dir === rootPath ? undefined : path.relative(rootPath, dir);
  const hasRequirements = fs.existsSync(path.join(dir, "requirements.txt"));

  let rawOutput: string;
  try {
    const args = ["--format", "json"];
    if (hasRequirements) {
      args.push("--requirement", path.join(dir, "requirements.txt"));
    }
    const result = await execFileAsync("pip-audit", args, {
      encoding: "utf-8",
      timeout: 120_000,
      cwd: dir,
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "pip-audit",
        findings: [],
        skipped: true,
        skipReason: "pip-audit not found",
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "pip-audit",
        findings: [],
        skipped: true,
        skipReason: `pip-audit failed${subProject ? " (" + subProject + ")" : ""}: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const packages: PipAuditPackage[] = JSON.parse(rawOutput);
    for (const pkg of packages) {
      for (const vuln of pkg.vulns) {
        const prefix = subProject ? `${subProject}: ` : "";
        findings.push({
          id: deterministicFindingId("pip", pkg.name, vuln.id),
          tool: "pip-audit",
          severity: mapPipSeverity(vuln.id, vuln.description),
          category: "DEPENDENCY",
          file: getPipFindingFile(subProject, hasRequirements),
          message: `${prefix}${pkg.name}@${pkg.version}: ${vuln.id}${vuln.description ? " \u2014 " + vuln.description : ""}`,
          recommendation:
            vuln.fix_versions && vuln.fix_versions.length > 0
              ? `Update to ${pkg.name}>=${vuln.fix_versions[vuln.fix_versions.length - 1]}`
              : "No fix version available — review manually",
          autoFixAvailable: !!(vuln.fix_versions && vuln.fix_versions.length > 0),
        });
      }
    }
  } catch {
    findings.push({
      id: "pip-audit-parse-error",
      tool: "pip-audit",
      severity: "MEDIUM",
      category: "SECURITY",
      message:
        "Failed to parse pip-audit output. The tool may have produced unexpected output format.",
      autoFixAvailable: false,
    });
  }

  return { tool: "pip-audit", findings, rawOutput };
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
