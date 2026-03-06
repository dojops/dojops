/**
 * Centralized child_process wrapper for the runtime package.
 * All OS command execution is routed through this helper so that
 * security audit tools (SonarCloud S4721) need only review this single file.
 */
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

/**
 * Run a binary with array arguments (no shell injection possible).
 */
export function runBin(
  binary: string,
  args: readonly string[],
  options?: ExecFileSyncOptions,
): Buffer | string {
  return execFileSync(binary, args, options ?? {}); // NOSONAR
}
