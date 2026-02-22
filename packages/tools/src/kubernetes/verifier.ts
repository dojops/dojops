import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VerificationResult } from "@odaops/sdk";

export async function verifyKubernetesYaml(yaml: string): Promise<VerificationResult> {
  const tmpFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "oda-kubectl-")),
    "manifest.yaml",
  );

  try {
    fs.writeFileSync(tmpFile, yaml, "utf-8");

    try {
      const rawOutput = execFileSync("kubectl", ["apply", "--dry-run=client", "-f", tmpFile], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });

      return {
        passed: true,
        tool: "kubectl dry-run",
        issues: [],
        rawOutput,
      };
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          passed: true,
          tool: "kubectl dry-run",
          issues: [{ severity: "warning", message: "kubectl not found — skipped" }],
        };
      }

      const execErr = err as { stderr?: string };
      const stderr = execErr.stderr ?? (err instanceof Error ? err.message : String(err));

      // Parse stderr lines for error messages
      const lines = stderr
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);

      const issues = lines.map((line: string) => ({
        severity: "error" as const,
        message: line,
      }));

      return {
        passed: false,
        tool: "kubectl dry-run",
        issues: issues.length > 0 ? issues : [{ severity: "error", message: stderr }],
        rawOutput: stderr,
      };
    }
  } finally {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
