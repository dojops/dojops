/**
 * CLI-specific shell command wrapper.
 * `runBin()` has been consolidated into `@dojops/sdk` — import it from there.
 * This file retains only `runShellCmd` which is CLI-specific (uses execSync).
 */
import { execSync, type ExecSyncOptions } from "node:child_process";

/**
 * Run a hardcoded shell command string.
 * Only for trusted, static commands like `npm config get prefix`.
 * NEVER pass user input to this function.
 */
export function runShellCmd(command: string, options?: ExecSyncOptions): Buffer | string {
  return execSync(command, options ?? {}); // NOSONAR
}
