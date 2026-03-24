/**
 * Runs review validation tools against existing files.
 *
 * Unlike `verifyWithBinary` (which writes generated content to a temp dir),
 * this runs tools directly against real project files for the DevSecOps reviewer.
 *
 * Security: only binaries in ALLOWED_VERIFICATION_BINARIES are executed.
 * Execution: uses `runBin()` (execFileSync) — no shell injection possible.
 */
import * as path from "node:path";
import { runBin } from "@dojops/sdk";
import { ALLOWED_VERIFICATION_BINARIES } from "./binary-verifier";
import { getParser } from "./parsers/index";
import type { ReviewToolSpec, ToolValidationResult } from "@dojops/core";

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Run a single review tool against a file.
 * Returns a ToolValidationResult compatible with DevSecOpsReviewer input.
 */
export function runReviewTool(
  filePath: string,
  spec: ReviewToolSpec,
  projectRoot: string,
): ToolValidationResult {
  if (!ALLOWED_VERIFICATION_BINARIES.has(spec.binary)) {
    return {
      tool: spec.binary,
      file: filePath,
      passed: true,
      issues: [{ severity: "info", message: `${spec.binary} not in allowed binaries — skipped` }],
    };
  }

  // Build args: replace {file} with absolute path, {dir} with file's directory
  const absPath = path.resolve(projectRoot, filePath);
  const dirPath = path.dirname(absPath);
  const args = spec.args.map((arg) =>
    arg.replaceAll("{file}", absPath).replaceAll("{dir}", dirPath),
  );

  const timeout = spec.timeout ?? 30000;

  try {
    const rawOutput = runBin(spec.binary, args, {
      encoding: "utf-8",
      timeout,
      stdio: "pipe",
      cwd: projectRoot,
    }) as string;

    // Tool exited 0 — parse output for any warnings
    const issues = parseToolOutput(rawOutput, spec);
    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      tool: spec.binary,
      file: filePath,
      passed: !hasErrors,
      issues,
      rawOutput: rawOutput.slice(0, 4000),
    };
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: spec.binary,
        file: filePath,
        passed: true,
        issues: [{ severity: "info", message: `${spec.binary} not installed — skipped` }],
      };
    }

    // Non-zero exit (most linting tools exit non-zero when issues found)
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const rawOutput =
      execErr.stdout || execErr.stderr || (err instanceof Error ? err.message : String(err));

    const issues = parseToolOutput(rawOutput, spec);
    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      tool: spec.binary,
      file: filePath,
      passed: issues.length === 0 ? false : !hasErrors,
      issues:
        issues.length > 0 ? issues : [{ severity: "error", message: rawOutput.slice(0, 1000) }],
      rawOutput: rawOutput.slice(0, 4000),
    };
  }
}

/**
 * Parse tool output using the spec's parser (if available) or generic parsing.
 */
function parseToolOutput(rawOutput: string, spec: ReviewToolSpec): ToolValidationResult["issues"] {
  if (!rawOutput.trim()) return [];

  if (spec.parser) {
    const parser = getParser(spec.parser);
    if (parser) {
      return parser(rawOutput).map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        line: issue.line,
        rule: issue.rule,
      }));
    }
  }

  // Fallback: generic parsing for tools without a dedicated parser
  const genericParser = getParser("generic-stderr");
  if (genericParser) {
    return genericParser(rawOutput).map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      line: issue.line,
      rule: issue.rule,
    }));
  }

  return [];
}

/**
 * Run multiple review tools for a list of file-spec pairs.
 *
 * The caller is responsible for matching files to specs (via `findToolsForFile`
 * from `@dojops/core`). This keeps the runner focused on execution only.
 *
 * @param entries - Array of { filePath, spec } pairs to execute
 * @param projectRoot - Absolute path to the project root
 * @returns Array of ToolValidationResult for all tools that were run
 */
export function runReviewTools(
  entries: { filePath: string; spec: ReviewToolSpec }[],
  projectRoot: string,
): ToolValidationResult[] {
  return entries.map(({ filePath, spec }) => runReviewTool(filePath, spec, projectRoot));
}
