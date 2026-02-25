import { execFileSync } from "node:child_process";
import { ScannerResult } from "../types";

export async function scanTrivySbom(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    rawOutput = execFileSync("trivy", ["sbom", "--format", "cyclonedx", projectPath], {
      encoding: "utf-8",
      timeout: 180_000,
      stdio: "pipe",
    });
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "trivy-sbom",
        findings: [],
        skipped: true,
        skipReason: "trivy not found",
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "trivy-sbom",
        findings: [],
        skipped: true,
        skipReason: `trivy sbom failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  return {
    tool: "trivy-sbom",
    findings: [],
    sbomOutput: rawOutput,
  };
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
