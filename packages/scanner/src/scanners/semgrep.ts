import { ScannerResult, ScanFinding, ScanSeverity } from "../types";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";

// Semgrep JSON output types
interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: {
      cwe?: string[];
      owasp?: string[];
      confidence?: string;
      category?: string;
      technology?: string[];
      references?: string[];
    };
    fix?: string;
  };
}

interface SemgrepOutput {
  results: SemgrepResult[];
  errors: Array<{ message: string }>;
}

/**
 * Run Semgrep SAST scanner for code-level security analysis.
 * Uses the "auto" config which detects the project languages and applies relevant rules.
 */
export async function scanSemgrep(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    const result = await execFileAsync(
      "semgrep",
      ["scan", "--json", "--config", "auto", "--quiet", projectPath],
      { encoding: "utf-8", timeout: 300_000 },
    );
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        tool: "semgrep",
        findings: [],
        skipped: true,
        skipReason: "semgrep not found in PATH",
      };
    }
    // Semgrep exits non-zero when findings are present — check for stdout
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "semgrep",
        findings: [],
        skipped: true,
        skipReason: `semgrep failed: ${execErr.stderr?.slice(0, 200) ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];
  try {
    const output: SemgrepOutput = JSON.parse(rawOutput);
    if (output.results) {
      for (const result of output.results) {
        const severity = mapSeverity(result.extra.severity);
        const cweList = result.extra.metadata?.cwe;
        const cwe = cweList && cweList.length > 0 ? cweList[0] : undefined;

        findings.push({
          id: deterministicFindingId(
            "semgrep",
            result.check_id,
            result.path,
            String(result.start.line),
          ),
          tool: "semgrep",
          severity,
          category: "SECURITY",
          file: result.path,
          line: result.start.line,
          message: `[${result.check_id}] ${result.extra.message}`,
          recommendation: result.extra.fix
            ? `Suggested fix available`
            : result.extra.metadata?.references?.[0]
              ? `See: ${result.extra.metadata.references[0]}`
              : undefined,
          autoFixAvailable: !!result.extra.fix,
          cwe,
        });
      }
    }
  } catch {
    findings.push({
      id: deterministicFindingId("semgrep", "parse-error"),
      tool: "semgrep",
      severity: "MEDIUM",
      category: "SECURITY",
      message: "Failed to parse semgrep output",
      autoFixAvailable: false,
    });
  }

  return { tool: "semgrep", findings, rawOutput };
}

function mapSeverity(severity: string): ScanSeverity {
  switch (severity.toUpperCase()) {
    case "ERROR":
      return "HIGH";
    case "WARNING":
      return "MEDIUM";
    case "INFO":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
