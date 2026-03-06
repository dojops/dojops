import { ScannerResult, ScanFinding } from "../types";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";
import { isENOENT, mapTrivySeverity, parseErrorFinding, skippedResult } from "../scanner-utils";

interface TrivyLicenseResult {
  Target: string;
  Class?: string;
  Licenses?: TrivyLicense[];
}

interface TrivyLicense {
  Severity: string;
  Category: string;
  PkgName: string;
  FilePath?: string;
  Name: string;
  Confidence?: number;
  Link?: string;
}

interface TrivyLicenseOutput {
  Results?: TrivyLicenseResult[];
}

export async function scanTrivyLicense(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    const result = await execFileAsync(
      "trivy",
      ["fs", "--scanners", "license", "--format", "json", projectPath],
      {
        encoding: "utf-8",
        timeout: 180_000,
      },
    );
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return skippedResult("trivy-license", "trivy not found");
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return skippedResult(
        "trivy-license",
        `trivy license scan failed: ${execErr.stderr ?? "unknown error"}`,
      );
    }
  }

  const findings: ScanFinding[] = [];

  try {
    const output: TrivyLicenseOutput = JSON.parse(rawOutput);
    if (output.Results) {
      for (const result of output.Results) {
        if (result.Licenses) {
          for (const lic of result.Licenses) {
            findings.push({
              id: deterministicFindingId("trivy-lic", lic.PkgName, lic.Name, lic.Category),
              tool: "trivy-license",
              severity: mapTrivySeverity(lic.Severity),
              category: "LICENSE",
              file: lic.FilePath ?? result.Target,
              message: `${lic.PkgName}: ${lic.Name} license (${lic.Category})`,
              recommendation: lic.Link
                ? `Review license terms: ${lic.Link}`
                : "Review license compliance requirements",
              autoFixAvailable: false,
            });
          }
        }
      }
    }
  } catch {
    findings.push(parseErrorFinding("trivy-license", "LICENSE"));
  }

  return { tool: "trivy-license", findings, rawOutput };
}
