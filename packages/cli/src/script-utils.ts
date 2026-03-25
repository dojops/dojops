import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

/** All recognized script extensions for content cleaning. */
const ALL_SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".ps1",
  ".psm1",
  ".bat",
  ".cmd",
]);

/**
 * Clean agent-generated script content before writing to disk.
 * Strips markdown code fences and LLM preamble text.
 */
export function cleanScriptContent(content: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALL_SCRIPT_EXTENSIONS.has(ext)) return content;

  let cleaned = content;

  // Strip markdown code fences: ```lang\n...\n``` or ~~~lang\n...\n~~~
  const fenceMatch = /^(?:```|~~~)\w*\n([\s\S]*?)\n(?:```|~~~)\s*$/.exec(cleaned.trim());
  if (fenceMatch) {
    cleaned = fenceMatch[1];
  } else {
    // Extract fenced block from anywhere (handles preamble text before the code)
    const innerMatch = /(?:```|~~~)\w*\n([\s\S]*?)\n(?:```|~~~)/.exec(cleaned);
    if (innerMatch) {
      cleaned = innerMatch[1];
    }
  }

  return cleaned;
}

/** File extensions that should get execute permission after write. */
const EXECUTABLE_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);

/** File extensions considered shell scripts for shebang verification. */
const SHELL_EXTENSIONS = new Set([".sh", ".bash", ".zsh"]);

/** File extensions considered Python scripts. */
const PYTHON_EXTENSIONS = new Set([".py"]);

/** File extensions considered PowerShell scripts. */
const POWERSHELL_EXTENSIONS = new Set([".ps1", ".psm1"]);

/**
 * Check if a file path is a shell script based on extension.
 */
export function isShellScript(filePath: string): boolean {
  return SHELL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Check if a file path is a Python script based on extension.
 */
export function isPythonScript(filePath: string): boolean {
  return PYTHON_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Check if a file path is a PowerShell script based on extension.
 */
export function isPowerShellScript(filePath: string): boolean {
  return POWERSHELL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Check if a file path is any recognized script type.
 */
export function isScriptFile(filePath: string): boolean {
  return isShellScript(filePath) || isPythonScript(filePath) || isPowerShellScript(filePath);
}

/**
 * Set execute permission on shell scripts after writing.
 * Only applies to .sh, .bash, .zsh files on non-Windows platforms.
 */
export function makeExecutable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!EXECUTABLE_EXTENSIONS.has(ext)) return false;
  if (process.platform === "win32") return false;

  try {
    fs.chmodSync(filePath, 0o755);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that a shell script starts with a valid shebang line.
 * Returns a warning message if missing, or null if valid.
 */
export function checkShebang(content: string, filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  // Only check shell and Python scripts
  if (!SHELL_EXTENSIONS.has(ext) && !PYTHON_EXTENSIONS.has(ext)) return null;

  const firstLine = content.split("\n")[0]?.trim() ?? "";
  if (firstLine.startsWith("#!")) return null;

  const scriptType = SHELL_EXTENSIONS.has(ext) ? "shell" : "Python";
  const suggested = SHELL_EXTENSIONS.has(ext) ? "#!/usr/bin/env bash" : "#!/usr/bin/env python3";
  return `${scriptType} script missing shebang line. Add "${suggested}" as the first line of ${path.basename(filePath)}.`;
}

export interface ScriptValidationResult {
  tool: string;
  available: boolean;
  passed: boolean;
  issues: string[];
}

/**
 * Check if a command-line tool is available.
 */
function isToolAvailable(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run post-generation validation on a script file.
 * Uses ShellCheck for shell scripts, py_compile for Python.
 * Returns null if no validator applies or is available.
 */
export function validateScript(filePath: string): ScriptValidationResult | null {
  const ext = path.extname(filePath).toLowerCase();

  if (SHELL_EXTENSIONS.has(ext)) {
    return validateShellScript(filePath);
  }
  if (PYTHON_EXTENSIONS.has(ext)) {
    return validatePythonScript(filePath);
  }
  return null;
}

function validateShellScript(filePath: string): ScriptValidationResult {
  const result: ScriptValidationResult = {
    tool: "shellcheck",
    available: false,
    passed: true,
    issues: [],
  };

  if (!isToolAvailable("shellcheck")) return result;
  result.available = true;

  try {
    execFileSync("shellcheck", ["--format=gcc", filePath], {
      stdio: "pipe",
      timeout: 30000,
    });
    // Exit 0 = no issues
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    // ShellCheck exits 1 for warnings/errors
    const output = error.stdout?.toString() ?? error.stderr?.toString() ?? "";
    if (output.trim()) {
      result.passed = false;
      result.issues = output
        .trim()
        .split("\n")
        .filter((line: string) => line.trim().length > 0)
        .slice(0, 10); // Limit to 10 issues
    }
  }

  return result;
}

function validatePythonScript(filePath: string): ScriptValidationResult {
  const result: ScriptValidationResult = {
    tool: "python3 -m py_compile",
    available: false,
    passed: true,
    issues: [],
  };

  if (!isToolAvailable("python3")) return result;
  result.available = true;

  try {
    execFileSync("python3", ["-m", "py_compile", filePath], {
      stdio: "pipe",
      timeout: 30000,
    });
    // Exit 0 = valid syntax
  } catch (err: unknown) {
    const error = err as { stderr?: Buffer };
    const output = error.stderr?.toString() ?? "";
    if (output.trim()) {
      result.passed = false;
      result.issues = output
        .trim()
        .split("\n")
        .filter((line: string) => line.trim().length > 0)
        .slice(0, 5);
    }
  }

  return result;
}
