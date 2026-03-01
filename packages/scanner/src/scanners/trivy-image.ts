import { ScannerResult, ScanFinding, ScanSeverity } from "../types";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";

interface TrivyImageVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  Description?: string;
  CVSS?: Record<string, { V3Score?: number; V2Score?: number }>;
}

interface TrivyImageResult {
  Target: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyImageVulnerability[];
}

interface TrivyImageOutput {
  Results?: TrivyImageResult[];
}

// Validate Docker image name format — reject argument injection and shell metacharacters
const SAFE_IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./:@-]{0,254}$/;

export async function scanTrivyImage(imageName: string): Promise<ScannerResult> {
  if (!SAFE_IMAGE_NAME.test(imageName)) {
    return {
      tool: "trivy-image",
      findings: [],
      skipped: true,
      skipReason: "Invalid image name format",
    };
  }

  let rawOutput: string;
  try {
    const result = await execFileAsync("trivy", ["image", "--format", "json", imageName], {
      encoding: "utf-8",
      timeout: 300_000,
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "trivy-image",
        findings: [],
        skipped: true,
        skipReason: "trivy not found",
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "trivy-image",
        findings: [],
        skipped: true,
        skipReason: `trivy image scan failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const output: TrivyImageOutput = JSON.parse(rawOutput);
    if (output.Results) {
      for (const result of output.Results) {
        if (result.Vulnerabilities) {
          for (const vuln of result.Vulnerabilities) {
            findings.push({
              id: deterministicFindingId("trivy-img", vuln.VulnerabilityID, vuln.PkgName),
              tool: "trivy-image",
              severity: mapSeverity(vuln.Severity),
              category: "SECURITY",
              file: result.Target,
              message: `${vuln.PkgName}@${vuln.InstalledVersion}: ${vuln.VulnerabilityID}${vuln.Title ? ` — ${vuln.Title}` : ""}`,
              recommendation: vuln.FixedVersion
                ? `Update to ${vuln.PkgName}@${vuln.FixedVersion}`
                : "No fix version available",
              autoFixAvailable: !!vuln.FixedVersion,
              cve: vuln.VulnerabilityID.startsWith("CVE-") ? vuln.VulnerabilityID : undefined,
              cvss: extractCvssScore(vuln.CVSS),
              fixVersion: vuln.FixedVersion || undefined,
            });
          }
        }
      }
    }
  } catch {
    findings.push({
      id: "trivy-image-parse-error",
      tool: "trivy-image",
      severity: "MEDIUM",
      category: "SECURITY",
      message:
        "Failed to parse trivy image scan output. The tool may have produced unexpected output format.",
      autoFixAvailable: false,
    });
  }

  return { tool: "trivy-image", findings, rawOutput };
}

function extractCvssScore(
  cvss?: Record<string, { V3Score?: number; V2Score?: number }>,
): number | undefined {
  if (!cvss) return undefined;
  let best: number | undefined;
  for (const entry of Object.values(cvss)) {
    const score = entry.V3Score ?? entry.V2Score;
    if (score !== undefined && (best === undefined || score > best)) {
      best = score;
    }
  }
  return best;
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

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
