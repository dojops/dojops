import { ScannerResult, ScanFinding } from "../types";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";
import { isENOENT, mapTrivySeverity, parseErrorFinding, skippedResult } from "../scanner-utils";

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
    return skippedResult("trivy-image", "Invalid image name format");
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
      return skippedResult("trivy-image", "trivy not found");
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return skippedResult(
        "trivy-image",
        `trivy image scan failed: ${execErr.stderr ?? "unknown error"}`,
      );
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const output: TrivyImageOutput = JSON.parse(rawOutput);
    for (const result of output.Results ?? []) {
      for (const vuln of result.Vulnerabilities ?? []) {
        findings.push(mapVulnToFinding(vuln, result.Target));
      }
    }
  } catch {
    findings.push(parseErrorFinding("trivy-image", "SECURITY"));
  }

  return { tool: "trivy-image", findings, rawOutput };
}

function mapVulnToFinding(vuln: TrivyImageVulnerability, target: string): ScanFinding {
  const titleSuffix = vuln.Title ? " \u2014 " + vuln.Title : "";
  return {
    id: deterministicFindingId("trivy-img", vuln.VulnerabilityID, vuln.PkgName),
    tool: "trivy-image",
    severity: mapTrivySeverity(vuln.Severity),
    category: "SECURITY",
    file: target,
    message: `${vuln.PkgName}@${vuln.InstalledVersion}: ${vuln.VulnerabilityID}${titleSuffix}`,
    recommendation: vuln.FixedVersion
      ? `Update to ${vuln.PkgName}@${vuln.FixedVersion}`
      : "No fix version available",
    autoFixAvailable: !!vuln.FixedVersion,
    cve: vuln.VulnerabilityID.startsWith("CVE-") ? vuln.VulnerabilityID : undefined,
    cvss: extractCvssScore(vuln.CVSS),
    fixVersion: vuln.FixedVersion || undefined,
  };
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
