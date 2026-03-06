import { ScannerResult } from "../types";
import { execFileAsync } from "../exec-async";
import { isENOENT, skippedResult } from "../scanner-utils";

export async function scanTrivySbom(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    const result = await execFileAsync("trivy", ["fs", "--format", "cyclonedx", projectPath], {
      encoding: "utf-8",
      timeout: 180_000,
    });
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return skippedResult("trivy-sbom", "trivy not found");
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return skippedResult(
        "trivy-sbom",
        `trivy fs --format cyclonedx failed: ${execErr.stderr ?? "unknown error"}`,
      );
    }
  }

  return {
    tool: "trivy-sbom",
    findings: [],
    sbomOutput: rawOutput,
  };
}
