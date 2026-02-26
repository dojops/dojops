import fs from "node:fs";
import nodePath from "node:path";
import { execSync, execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  ToolDependency,
  ToolCheckResult,
  PreflightResult,
  aggregatePreflight,
  getInstallCommand,
  ALL_SPECIALIST_CONFIGS,
  SYSTEM_TOOLS,
  findSystemTool,
  isToolSupportedOnCurrentPlatform,
} from "@dojops/core";
import { TOOLS_BIN_DIR, loadToolRegistry, installSystemTool, verifyTool } from "./tool-sandbox";

/**
 * Attempt to resolve a binary on PATH.
 * Checks ~/.dojops/tools/bin/ first (if it exists), then system PATH.
 * Returns the absolute path if found, undefined otherwise.
 */
export function resolveBinary(name: string): string | undefined {
  // Check sandbox first
  if (fs.existsSync(TOOLS_BIN_DIR)) {
    const sandboxPath = nodePath.join(TOOLS_BIN_DIR, name);
    if (fs.existsSync(sandboxPath)) {
      return sandboxPath;
    }
  }

  try {
    const bin = process.platform === "win32" ? "where" : "which";
    const result = execFileSync(bin, [name], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = result.toString().trim().split("\n")[0];
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attempt to resolve a library-only (no binary) dependency.
 * Checks local node_modules first, then the npm global prefix.
 */
export function resolveModule(npmPackage: string): string | undefined {
  try {
    return require.resolve(npmPackage);
  } catch {
    // Fall through to global check
  }

  // Check npm global prefix (handles globally-installed library-only packages)
  try {
    const prefix = execSync("npm config get prefix", {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    const globalPath = nodePath.join(prefix, "lib", "node_modules", npmPackage);
    if (fs.existsSync(globalPath)) {
      return globalPath;
    }
  } catch {
    // ignore
  }

  return undefined;
}

/**
 * Check all dependencies for a given agent. Returns a PreflightResult.
 */
export function runPreflight(agentName: string, deps: ToolDependency[]): PreflightResult {
  const checks: ToolCheckResult[] = deps.map((dep) => {
    if (dep.binary) {
      const resolvedPath = resolveBinary(dep.binary);
      return { dependency: dep, available: !!resolvedPath, resolvedPath };
    }
    // Library-only dependency
    const resolvedPath = resolveModule(dep.npmPackage);
    return { dependency: dep, available: !!resolvedPath, resolvedPath };
  });

  return aggregatePreflight(agentName, checks);
}

export interface PreflightOptions {
  quiet?: boolean;
  json?: boolean;
}

/**
 * Run preflight checks and render results via @clack/prompts.
 *
 * Returns true if execution can proceed, false if blocked by missing required tools.
 */
export function preflightCheck(
  agentName: string,
  deps: ToolDependency[],
  opts: PreflightOptions = {},
): boolean {
  if (deps.length === 0) return true;

  const result = runPreflight(agentName, deps);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.canProceed;
  }

  // Quiet mode: skip output if everything is fine
  if (opts.quiet && result.canProceed && result.missingOptional.length === 0) {
    return true;
  }

  // Missing optional tools — warn but continue
  if (result.missingOptional.length > 0) {
    const lines = result.missingOptional.map(
      (dep) =>
        `  ${pc.yellow("!")} ${pc.bold(dep.name)} — ${dep.description}\n    Install: ${pc.dim(getInstallCommand(dep, "npx"))}`,
    );
    p.log.warn(`Optional tools not found:\n${lines.join("\n")}`);
  }

  // Missing required tools — error and block
  if (result.missingRequired.length > 0) {
    const lines = result.missingRequired.map(
      (dep) =>
        `  ${pc.red("\u2717")} ${pc.bold(dep.name)} — ${dep.description}\n    Install: ${pc.dim(getInstallCommand(dep, "npx"))}`,
    );
    p.log.error(`Required tools missing:\n${lines.join("\n")}`);
    return false;
  }

  return true;
}

/**
 * Collect all unique tool dependencies from specialist agents
 * and check which ones are missing.
 */
export function collectMissingTools(): ToolDependency[] {
  const seen = new Set<string>();
  const uniqueDeps: ToolDependency[] = [];
  for (const config of ALL_SPECIALIST_CONFIGS) {
    for (const dep of config.toolDependencies ?? []) {
      if (!seen.has(dep.npmPackage)) {
        seen.add(dep.npmPackage);
        uniqueDeps.push(dep);
      }
    }
  }

  return uniqueDeps.filter((dep) => {
    const found = dep.binary ? resolveBinary(dep.binary) : resolveModule(dep.npmPackage);
    return !found;
  });
}

/**
 * Check whether npm global installs need elevated permissions.
 * Returns true if the npm global prefix directory is not writable.
 */
function needsSudo(): boolean {
  try {
    const prefix = execSync("npm config get prefix", {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
    fs.accessSync(prefix, fs.constants.W_OK);
    return false;
  } catch {
    return true;
  }
}

/**
 * Check whether sudo is available on the system.
 */
function hasSudo(): boolean {
  return !!resolveBinary("sudo");
}

/**
 * Install an npm package globally. Uses sudo when the global prefix
 * is not writable and sudo is available.
 */
function npmInstallGlobal(pkg: string, useSudo: boolean): void {
  if (useSudo) {
    execFileSync("sudo", ["npm", "install", "-g", pkg], {
      timeout: 120_000,
      stdio: "pipe",
    });
  } else {
    execFileSync("npm", ["install", "-g", pkg], {
      timeout: 120_000,
      stdio: "pipe",
    });
  }
}

/**
 * Interactively offer to install missing tool dependencies.
 * Respects non-interactive mode (skips prompt, only warns).
 * Detects permission issues and uses sudo when needed.
 * Returns the list of successfully installed package names.
 */
export async function offerToolInstall(options?: { nonInteractive?: boolean }): Promise<string[]> {
  const missing = collectMissingTools();
  if (missing.length === 0) {
    p.log.success("All optional agent tools are installed.");
    return [];
  }

  const lines = missing.map(
    (dep) =>
      `  ${pc.yellow("!")} ${pc.bold(dep.name)} — ${dep.description}\n    ${pc.dim(getInstallCommand(dep, "npm"))}`,
  );
  p.log.warn(`${missing.length} optional tool(s) not found:\n${lines.join("\n")}`);

  if (options?.nonInteractive) {
    return [];
  }

  const selected = await p.multiselect({
    message: "Select tools to install globally:",
    options: missing.map((dep) => ({
      value: dep.npmPackage,
      label: dep.name,
      hint: dep.description,
    })),
    required: false,
  });

  if (p.isCancel(selected) || selected.length === 0) {
    return [];
  }

  // Detect if we need elevated permissions
  const useSudo = needsSudo();
  const sudoAvailable = useSudo ? hasSudo() : false;

  if (useSudo && !sudoAvailable) {
    const cmds = selected.map((pkg) => `  sudo npm install -g ${pkg}`);
    p.log.warn(
      `Global npm directory requires elevated permissions.\nRun manually:\n${cmds.join("\n")}`,
    );
    return [];
  }

  if (useSudo) {
    p.log.info(pc.dim("Elevated permissions required — using sudo for global install."));
  }

  const installed: string[] = [];
  for (const pkg of selected) {
    const dep = missing.find((d) => d.npmPackage === pkg)!;
    const prefix = useSudo ? "sudo " : "";
    const s = p.spinner();
    s.start(`Installing ${dep.name} (${prefix}npm install -g ${pkg})...`);
    try {
      npmInstallGlobal(pkg, useSudo);
      s.stop(`${pc.green("\u2713")} ${dep.name} installed.`);
      installed.push(pkg);
    } catch (err) {
      s.stop(`${pc.red("\u2717")} ${dep.name} failed.`);
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Failed to install ${dep.name}: ${msg}`);
    }
  }

  if (installed.length > 0) {
    p.log.success(`${installed.length} tool(s) installed.`);
  }

  return installed;
}

/**
 * Collect system tools that are not installed anywhere (sandbox or system PATH).
 */
export function collectMissingSystemTools(): typeof SYSTEM_TOOLS {
  const registry = loadToolRegistry();
  return SYSTEM_TOOLS.filter((tool) => {
    if (!isToolSupportedOnCurrentPlatform(tool)) return false;
    if (registry.tools.find((t) => t.name === tool.name)) return false;
    if (resolveBinary(tool.binaryName)) return false;
    return true;
  });
}

/**
 * Interactively offer to install missing system tools into the sandbox.
 * Returns the list of successfully installed tool names.
 */
export async function offerSystemToolInstall(options?: {
  nonInteractive?: boolean;
}): Promise<string[]> {
  const missing = collectMissingSystemTools();
  if (missing.length === 0) {
    p.log.success("All system tools are installed.");
    return [];
  }

  const lines = missing.map(
    (tool) =>
      `  ${pc.yellow("!")} ${pc.bold(tool.name)} — ${tool.description}\n    ${pc.dim(`dojops tools install ${tool.name}`)}`,
  );
  p.log.warn(`${missing.length} system tool(s) not found:\n${lines.join("\n")}`);

  if (options?.nonInteractive) {
    return [];
  }

  const selected = await p.multiselect({
    message: "Select system tools to install into sandbox (~/.dojops/tools/):",
    options: missing.map((tool) => ({
      value: tool.name,
      label: tool.name,
      hint: tool.description,
    })),
    required: false,
  });

  if (p.isCancel(selected) || selected.length === 0) {
    return [];
  }

  const installed: string[] = [];
  for (const name of selected) {
    const tool = findSystemTool(name)!;
    const s = p.spinner();
    s.start(`Installing ${tool.name}...`);
    try {
      const result = await installSystemTool(tool);
      s.stop(`${pc.green("\u2713")} ${tool.name} v${result.version} installed.`);
      const versionOutput = verifyTool(tool);
      if (versionOutput) {
        p.log.info(pc.dim(versionOutput));
      }
      installed.push(name);
    } catch (err) {
      s.stop(`${pc.red("\u2717")} ${tool.name} failed.`);
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Failed to install ${tool.name}: ${msg}`);
    }
  }

  if (installed.length > 0) {
    p.log.success(`${installed.length} system tool(s) installed.`);
  }

  return installed;
}
