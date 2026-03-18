import fs from "node:fs";
import nodePath from "node:path";
import { runBin, runShellCmd } from "./safe-exec";
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
  SystemTool,
  findSystemTool,
  isToolSupportedOnCurrentPlatform,
} from "@dojops/core";
import { toErrorMessage } from "./exit-codes";
import {
  TOOLCHAIN_BIN_DIR,
  TOOLCHAIN_DIR,
  TOOLCHAIN_NODE_MODULES,
  TOOLCHAIN_NPM_BIN,
  ensureToolchainDir,
  loadToolchainRegistry,
  installSystemTool,
  verifyTool,
} from "./toolchain-sandbox";

/**
 * Attempt to look up correct install instructions via Context7.
 * Returns install hint text if found, undefined otherwise.
 */
async function lookupInstallHint(skillName: string): Promise<string | undefined> {
  if (process.env.DOJOPS_CONTEXT_ENABLED === "false") return undefined;
  try {
    const { Context7Client } = await import("@dojops/context");
    const client = new Context7Client({ apiKey: process.env.DOJOPS_CONTEXT7_API_KEY });
    const lib = await client.resolveLibrary(skillName, `install ${skillName} npm`);
    if (!lib) return undefined;
    const docs = await client.queryDocs(lib.id, `how to install ${skillName}`);
    if (!docs || docs.length < 20) return undefined;
    // Extract first useful paragraph (up to 500 chars)
    const trimmed = docs.slice(0, 500).trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find the project toolchain bin dir by walking up from cwd.
 * Returns undefined if no .dojops/toolchain/bin/ is found.
 */
function findProjectToolchainBinDir(): string | undefined {
  let dir = process.cwd();
  const root = nodePath.parse(dir).root;
  while (dir !== root) {
    const binDir = nodePath.join(dir, ".dojops", "toolchain", "bin");
    if (fs.existsSync(binDir)) return binDir;
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Attempt to resolve a binary on PATH.
 * Checks project toolchain first, then global toolchain, then system PATH.
 * Returns the absolute path if found, undefined otherwise.
 */
export function resolveBinary(name: string): string | undefined {
  // Check project-scoped toolchain first (installed via `dojops toolchain install --scope=project`)
  const projectBinDir = findProjectToolchainBinDir();

  const dirs = [...(projectBinDir ? [projectBinDir] : []), TOOLCHAIN_BIN_DIR, TOOLCHAIN_NPM_BIN];

  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      const sandboxPath = nodePath.join(dir, name);
      if (fs.existsSync(sandboxPath)) {
        return sandboxPath;
      }
    }
  }

  try {
    const bin = process.platform === "win32" ? "where" : "which";
    const result = runBin(bin, [name], {
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
 * Checks local node_modules, then toolchain sandbox, then npm global prefix.
 */
export function resolveModule(npmPackage: string): string | undefined {
  try {
    return require.resolve(npmPackage);
  } catch {
    // Fall through to sandbox / global check
  }

  // Check sandboxed toolchain node_modules
  const sandboxPath = nodePath.join(TOOLCHAIN_NODE_MODULES, npmPackage);
  if (fs.existsSync(sandboxPath)) {
    return sandboxPath;
  }

  // Check npm global prefix (handles globally-installed library-only packages)
  try {
    const prefix = (
      runShellCmd("npm config get prefix", {
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }) as string
    ).trim();
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
 * Collect missing tool dependencies filtered by relevant project domains.
 * Only returns tools from specialists whose domain matches the project.
 */
export function collectMissingToolsForDomains(domains: string[]): ToolDependency[] {
  if (domains.length === 0) return collectMissingTools();

  const domainSet = new Set(domains);
  const seen = new Set<string>();
  const uniqueDeps: ToolDependency[] = [];
  for (const config of ALL_SPECIALIST_CONFIGS) {
    if (!domainSet.has(config.domain)) continue;
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
 * Install an npm package into the sandboxed toolchain (~/.dojops/toolchain/).
 * No elevated permissions required.
 */
function npmInstallSandboxed(pkg: string): void {
  ensureToolchainDir();
  runBin("npm", ["install", "--prefix", TOOLCHAIN_DIR, pkg], {
    timeout: 120_000,
    stdio: "pipe",
  });
}

/** Prompt user to select tools to install into the toolchain sandbox. */
async function selectToolsForInstall(missing: ToolDependency[]): Promise<string[] | null> {
  const selected = await p.multiselect({
    message: "Select tools to install into toolchain (~/.dojops/toolchain/):",
    options: missing.map((dep) => ({
      value: dep.npmPackage,
      label: dep.name,
      hint: dep.description,
    })),
    required: false,
  });

  if (p.isCancel(selected) || selected.length === 0) return null;

  return selected;
}

/** Install a list of npm packages into the toolchain sandbox. Returns successfully installed package names. */
async function installNpmPackages(
  packages: string[],
  missing: ToolDependency[],
): Promise<string[]> {
  const installed: string[] = [];
  const manualInstall: Array<{ dep: ToolDependency; hint?: string }> = [];

  for (const pkg of packages) {
    const dep = missing.find((d) => d.npmPackage === pkg)!;
    const s = p.spinner();
    s.start(`Installing ${dep.name} into toolchain...`);
    try {
      npmInstallSandboxed(pkg);
      s.stop(`${pc.green("\u2713")} ${dep.name} installed.`);
      installed.push(pkg);
      continue;
    } catch {
      s.stop(`${pc.yellow("!")} ${dep.name} failed — checking install method...`);
    }

    // Look up correct install instructions via Context7 and retry
    const hint = await lookupInstallHint(dep.npmPackage);
    if (hint) {
      p.log.info(pc.dim(`Context7: found install info for ${dep.name}`));
    }

    const retrySpinner = p.spinner();
    retrySpinner.start(`Retrying ${dep.name}...`);
    try {
      npmInstallSandboxed(pkg);
      retrySpinner.stop(`${pc.green("\u2713")} ${dep.name} installed on retry.`);
      installed.push(pkg);
    } catch (err) {
      retrySpinner.stop(`${pc.red("\u2717")} ${dep.name} failed.`);
      p.log.warn(`Could not install ${dep.name}: ${toErrorMessage(err)}`);
      manualInstall.push({ dep, hint });
    }
  }

  if (manualInstall.length > 0) {
    p.log.info(pc.yellow(`\n${manualInstall.length} tool(s) require manual installation:`));
    for (const { dep, hint } of manualInstall) {
      const lines = [
        `  ${pc.bold(dep.name)} (${dep.npmPackage})`,
        `    ${pc.dim("npm install -g " + dep.npmPackage)}`,
      ];
      if (hint) {
        lines.push(`    ${pc.dim("Context7 hint:")} ${pc.dim(hint.split("\n")[0])}`);
      }
      p.log.message(lines.join("\n"));
    }
  }

  return installed;
}

export async function offerToolInstall(options?: {
  nonInteractive?: boolean;
  domains?: string[];
  autoInstallAll?: boolean;
}): Promise<string[]> {
  const missing = options?.domains
    ? collectMissingToolsForDomains(options.domains)
    : collectMissingTools();
  if (missing.length === 0) {
    p.log.success("All optional agent tools are installed.");
    return [];
  }

  const lines = missing.map(
    (dep) =>
      `  ${pc.yellow("!")} ${pc.bold(dep.name)} — ${dep.description}\n    ${pc.dim(getInstallCommand(dep, "npm"))}`,
  );
  p.log.warn(`${missing.length} optional tool(s) not found:\n${lines.join("\n")}`);

  if (options?.nonInteractive) return [];

  // Auto-install all (used by doctor --fix)
  const selected = options?.autoInstallAll
    ? missing.map((d) => d.npmPackage)
    : await selectToolsForInstall(missing);
  if (!selected) return [];

  const installed = await installNpmPackages(selected, missing);
  if (installed.length > 0) {
    p.log.success(`${installed.length} tool(s) installed to ~/.dojops/toolchain/.`);
  }

  return installed;
}

/**
 * Collect system tools that are not installed anywhere (sandbox or system PATH).
 */
export function collectMissingSystemTools(): typeof SYSTEM_TOOLS {
  const registry = loadToolchainRegistry();
  return SYSTEM_TOOLS.filter((tool) => {
    if (!isToolSupportedOnCurrentPlatform(tool)) return false;
    if (registry.tools.some((t) => t.name === tool.name)) return false;
    if (resolveBinary(tool.binaryName)) return false;
    return true;
  });
}

/** Maps system tool names to the specialist domains they serve. */
export const SYSTEM_TOOL_DOMAINS: Record<string, string[]> = {
  terraform: ["infrastructure", "cloud-architecture"],
  kubectl: ["container-orchestration"],
  gh: ["ci-cd", "ci-debugging"],
  hadolint: ["containerization"],
  trivy: ["security", "application-security"],
  gitleaks: ["security", "application-security"],
  ansible: ["infrastructure"],
  helm: ["container-orchestration"],
  shellcheck: ["shell-scripting", "ci-cd"],
  actionlint: ["ci-cd", "ci-debugging"],
  promtool: ["observability"],
  circleci: ["ci-cd"],
  "whisper-cpp": ["voice-input"],
};

/**
 * Collect missing system tools filtered by relevant project domains.
 * Only returns tools whose associated domains overlap with the project's domains.
 */
export function collectMissingSystemToolsForDomains(domains: string[]): typeof SYSTEM_TOOLS {
  if (domains.length === 0) return collectMissingSystemTools();

  const domainSet = new Set(domains);
  const registry = loadToolchainRegistry();
  return SYSTEM_TOOLS.filter((tool) => {
    if (!isToolSupportedOnCurrentPlatform(tool)) return false;
    if (registry.tools.some((t) => t.name === tool.name)) return false;
    if (resolveBinary(tool.binaryName)) return false;
    // Filter by domain relevance
    const toolDomains = SYSTEM_TOOL_DOMAINS[tool.name] ?? [];
    return toolDomains.some((d) => domainSet.has(d));
  });
}

/**
 * Interactively offer to install missing system tools into the sandbox.
 * Returns the list of successfully installed tool names.
 */
async function selectSystemToolsToInstall(
  missing: typeof SYSTEM_TOOLS,
  options?: { autoInstallAll?: boolean },
): Promise<string[] | null> {
  if (options?.autoInstallAll) {
    return missing.map((t) => t.name);
  }

  const picked = await p.multiselect({
    message: "Select system tools to install into toolchain (~/.dojops/toolchain/):",
    options: missing.map((tool) => ({
      value: tool.name,
      label: tool.name,
      hint: tool.description,
    })),
    required: false,
  });

  if (p.isCancel(picked) || picked.length === 0) {
    return null;
  }
  return picked;
}

async function installSystemToolWithRetry(
  name: string,
): Promise<{ success: true } | { success: false; hint?: string }> {
  const tool = findSystemTool(name)!;
  const s = p.spinner();
  s.start(`Installing ${tool.name}...`);

  try {
    const result = await installSystemTool(tool);
    s.stop(`${pc.green("\u2713")} ${tool.name} v${result.version} installed.`);
    const versionOutput = verifyTool(tool);
    if (versionOutput) p.log.info(pc.dim(versionOutput));
    return { success: true };
  } catch {
    s.stop(`${pc.yellow("!")} ${tool.name} failed — retrying...`);
  }

  const [retryResult, hint] = await Promise.allSettled([
    installSystemTool(tool),
    lookupInstallHint(tool.name),
  ]);

  if (retryResult.status === "fulfilled") {
    p.log.success(
      `${pc.green("\u2713")} ${tool.name} v${retryResult.value.version} installed on retry.`,
    );
    const versionOutput = verifyTool(tool);
    if (versionOutput) p.log.info(pc.dim(versionOutput));
    return { success: true };
  }

  p.log.error(`${pc.red("\u2717")} ${tool.name} could not be installed.`);
  const installHint = hint.status === "fulfilled" ? hint.value : undefined;
  return { success: false, hint: installHint };
}

export async function offerSystemToolInstall(options?: {
  nonInteractive?: boolean;
  domains?: string[];
  autoInstallAll?: boolean;
}): Promise<string[]> {
  const missing = options?.domains
    ? collectMissingSystemToolsForDomains(options.domains)
    : collectMissingSystemTools();
  if (missing.length === 0) {
    p.log.success("All system tools are installed.");
    return [];
  }

  const lines = missing.map((tool) => {
    const installCmd = pc.dim("dojops toolchain install " + tool.name);
    return `  ${pc.yellow("!")} ${pc.bold(tool.name)} — ${tool.description}\n    ${installCmd}`;
  });
  p.log.warn(`${missing.length} system tool(s) not found:\n${lines.join("\n")}`);

  if (options?.nonInteractive) return [];

  const selected = await selectSystemToolsToInstall(missing, options);
  if (!selected) return [];

  const installed: string[] = [];
  const manualInstall: Array<{ tool: SystemTool; hint?: string }> = [];

  for (const name of selected) {
    const result = await installSystemToolWithRetry(name);
    if (result.success) {
      installed.push(name);
    } else {
      manualInstall.push({ tool: findSystemTool(name)!, hint: result.hint });
    }
  }

  if (manualInstall.length > 0) {
    p.log.info(pc.yellow(`\n${manualInstall.length} system tool(s) require manual installation:`));
    for (const { tool, hint } of manualInstall) {
      const infoLines = [
        `  ${pc.bold(tool.name)} — ${tool.description}`,
        `    ${pc.dim("dojops toolchain install " + tool.name)}`,
        `    ${pc.dim("or visit the project page to install manually")}`,
      ];
      if (hint) {
        infoLines.push(`    ${pc.dim("Context7 hint:")} ${pc.dim(hint.split("\n")[0])}`);
      }
      p.log.message(infoLines.join("\n"));
    }
  }

  if (installed.length > 0) {
    p.log.success(`${installed.length} system tool(s) installed.`);
  }

  return installed;
}
