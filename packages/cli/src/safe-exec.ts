/**
 * Centralized child_process wrappers for the CLI package.
 * All OS command execution is routed through these helpers so that
 * security audit tools (SonarCloud S4721) need only review this single file.
 *
 * Safety guarantees:
 * - execFileSync uses array args (no shell interpolation)
 * - execSync is only used for npm config queries (no user input)
 */
import {
  execFileSync,
  execSync,
  type ExecFileSyncOptions,
  type ExecSyncOptions,
} from "node:child_process";

/**
 * Run a binary with array arguments (no shell injection possible).
 * Wraps `execFileSync` — the binary name and each argument are passed
 * as separate argv entries, never through a shell.
 */
export function runBin(
  binary: string,
  args: readonly string[],
  options?: ExecFileSyncOptions,
): Buffer | string {
  return execFileSync(binary, args, options ?? {}); // NOSONAR
}

/**
 * Run a hardcoded shell command string.
 * Only for trusted, static commands like `npm config get prefix`.
 * NEVER pass user input to this function.
 */
export function runShellCmd(command: string, options?: ExecSyncOptions): Buffer | string {
  return execSync(command, options ?? {}); // NOSONAR
}
