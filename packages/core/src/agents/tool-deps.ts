/**
 * Agent tool dependency declarations and pure helper functions.
 *
 * Data-only — no I/O, no child_process, no TUI.
 * Runtime checking lives in @dojops/cli (preflight.ts).
 */

export interface ToolDependency {
  /** Human-readable name, e.g. "ShellCheck" */
  name: string;
  /** npm package name, e.g. "shellcheck" or "@open-policy-agent/opa-wasm" */
  npmPackage: string;
  /** CLI binary name if the dep exposes one (omit for library-only deps) */
  binary?: string;
  /** Short description of what the tool does */
  description: string;
  /** If true, missing tool blocks execution. All current deps are optional. */
  required: boolean;
}

export interface ToolCheckResult {
  dependency: ToolDependency;
  available: boolean;
  /** Absolute path to the binary, if found */
  resolvedPath?: string;
}

export interface PreflightResult {
  agentName: string;
  checks: ToolCheckResult[];
  /** True when all required deps are present (always true if none are required) */
  canProceed: boolean;
  missingRequired: ToolDependency[];
  missingOptional: ToolDependency[];
}

export type PackageRunner = "npx" | "npm" | "pnpm";

/**
 * Returns the install/run command for a dependency using the given runner.
 *
 * - npx: `npx <package>`
 * - npm: `dojops init` (sandboxed install into ~/.dojops/toolchain/)
 * - pnpm: `pnpm add -g <package>`
 */
export function getInstallCommand(dep: ToolDependency, runner: PackageRunner): string {
  switch (runner) {
    case "npx":
      return `npx ${dep.npmPackage}`;
    case "npm":
      return `dojops init (installs ${dep.npmPackage} into ~/.dojops/toolchain/)`;
    case "pnpm":
      return `pnpm add -g ${dep.npmPackage}`;
  }
}

/**
 * Pure aggregation of check results into a PreflightResult.
 */
export function aggregatePreflight(agentName: string, checks: ToolCheckResult[]): PreflightResult {
  const missingRequired = checks
    .filter((c) => !c.available && c.dependency.required)
    .map((c) => c.dependency);
  const missingOptional = checks
    .filter((c) => !c.available && !c.dependency.required)
    .map((c) => c.dependency);

  return {
    agentName,
    checks,
    canProceed: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  };
}
