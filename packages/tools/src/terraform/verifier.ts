import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VerificationResult } from "@dojops/sdk";

interface TerraformDiagnostic {
  severity: "error" | "warning";
  summary: string;
  detail?: string;
}

interface TerraformValidateOutput {
  valid: boolean;
  diagnostics?: TerraformDiagnostic[];
}

export async function verifyTerraformHcl(hcl: string): Promise<VerificationResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tf-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "main.tf"), hcl, "utf-8");

    try {
      execFileSync("terraform", ["-chdir=" + tmpDir, "init", "-backend=false", "-input=false"], {
        encoding: "utf-8",
        timeout: 60_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          passed: true,
          tool: "terraform validate",
          issues: [{ severity: "warning", message: "terraform not found — skipped" }],
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        tool: "terraform validate",
        issues: [{ severity: "error", message: `terraform init failed: ${msg}` }],
      };
    }

    let rawOutput: string;
    try {
      rawOutput = execFileSync("terraform", ["-chdir=" + tmpDir, "validate", "-json"], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          passed: true,
          tool: "terraform validate",
          issues: [{ severity: "warning", message: "terraform not found — skipped" }],
        };
      }
      // terraform validate exits non-zero on invalid config but still outputs JSON to stdout
      const execErr = err as { stdout?: string; stderr?: string };
      rawOutput = execErr.stdout ?? "";
      if (!rawOutput) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          passed: false,
          tool: "terraform validate",
          issues: [{ severity: "error", message: `terraform validate failed: ${msg}` }],
          rawOutput: execErr.stderr,
        };
      }
    }

    let parsed: TerraformValidateOutput;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      return {
        passed: false,
        tool: "terraform validate",
        issues: [{ severity: "error", message: "Failed to parse terraform validate JSON output" }],
        rawOutput,
      };
    }

    const issues = (parsed.diagnostics ?? []).map((d) => ({
      severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
      message: d.detail ? `${d.summary}: ${d.detail}` : d.summary,
    }));

    return {
      passed: parsed.valid,
      tool: "terraform validate",
      issues,
      rawOutput,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
