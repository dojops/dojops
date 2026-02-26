import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding, ScanSeverity, ScanCategory } from "../types";

interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  Description?: string;
}

interface TrivyMisconfiguration {
  ID: string;
  Title: string;
  Description: string;
  Severity: string;
  Resolution?: string;
}

interface TrivySecret {
  RuleID: string;
  Title: string;
  Severity: string;
  Match: string;
  StartLine: number;
}

interface TrivyResult {
  Target: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
  Misconfigurations?: TrivyMisconfiguration[];
  Secrets?: TrivySecret[];
}

interface TrivyOutput {
  Results?: TrivyResult[];
}

export async function scanTrivy(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    rawOutput = execFileSync(
      "trivy",
      ["fs", "--format", "json", "--scanners", "vuln,secret,misconfig", projectPath],
      {
        encoding: "utf-8",
        timeout: 180_000,
        stdio: "pipe",
      },
    );
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "trivy",
        findings: [],
        skipped: true,
        skipReason: "trivy not found",
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "trivy",
        findings: [],
        skipped: true,
        skipReason: `trivy failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const output: TrivyOutput = JSON.parse(rawOutput);
    if (output.Results) {
      for (const result of output.Results) {
        // Vulnerabilities
        if (result.Vulnerabilities) {
          for (const vuln of result.Vulnerabilities) {
            findings.push({
              id: `trivy-${crypto.randomUUID().slice(0, 8)}`,
              tool: "trivy",
              severity: mapSeverity(vuln.Severity),
              category: "SECURITY",
              file: result.Target,
              message: `${vuln.PkgName}@${vuln.InstalledVersion}: ${vuln.VulnerabilityID}${vuln.Title ? ` — ${vuln.Title}` : ""}`,
              recommendation: vuln.FixedVersion
                ? `Update to ${vuln.PkgName}@${vuln.FixedVersion}`
                : "No fix version available",
              autoFixAvailable: !!vuln.FixedVersion,
            });
          }
        }

        // Misconfigurations
        if (result.Misconfigurations) {
          for (const misconfig of result.Misconfigurations) {
            findings.push({
              id: `trivy-${crypto.randomUUID().slice(0, 8)}`,
              tool: "trivy",
              severity: mapSeverity(misconfig.Severity),
              category: "IAC",
              file: result.Target,
              message: `${misconfig.ID}: ${misconfig.Title}`,
              recommendation: misconfig.Resolution ?? misconfig.Description,
              autoFixAvailable: false,
            });
          }
        }

        // Secrets
        if (result.Secrets) {
          for (const secret of result.Secrets) {
            findings.push({
              id: `trivy-${crypto.randomUUID().slice(0, 8)}`,
              tool: "trivy",
              severity: "CRITICAL",
              category: "SECRETS",
              file: result.Target,
              line: secret.StartLine,
              message: `${secret.RuleID}: ${secret.Title}`,
              recommendation: "Remove secret from source code and rotate credentials",
              autoFixAvailable: false,
            });
          }
        }
      }
    }
  } catch {
    findings.push({
      id: "trivy-parse-error",
      tool: "trivy",
      severity: "LOW",
      category: "SECURITY",
      message: "Failed to parse trivy output. The tool may have produced unexpected output format.",
      autoFixAvailable: false,
    });
  }

  return { tool: "trivy", findings, rawOutput };
}

function mapSeverity(severity: string): ScanSeverity {
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
    case "UNKNOWN":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

// Re-export for shared use
export function mapTrivyCategory(type: "vuln" | "misconfig" | "secret"): ScanCategory {
  switch (type) {
    case "vuln":
      return "SECURITY";
    case "misconfig":
      return "IAC";
    case "secret":
      return "SECRETS";
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
