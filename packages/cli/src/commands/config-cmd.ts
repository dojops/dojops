import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  readConfigFile,
  saveConfig,
  getConfigPath,
  getLocalConfigPath,
  getGlobalConfigPath,
  validateProvider,
  resolveProvider,
  getActiveProfile,
  VALID_PROVIDERS,
  DojOpsConfig,
} from "../config";
import { CLIContext } from "../types";
import { maskToken, truncateNoteTitle } from "../formatter";
import { extractFlagValue, hasFlag } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot, dojopsDir } from "../state";
import { createProvider } from "@dojops/api";
import { isCopilotAuthenticated, copilotLogin } from "@dojops/core";

function formatProviderDisplay(config: DojOpsConfig, isProjectScope: boolean): string {
  const hasEnvOverride =
    !isProjectScope &&
    process.env.DOJOPS_PROVIDER &&
    process.env.DOJOPS_PROVIDER !== config.defaultProvider;

  if (!hasEnvOverride) {
    return config.defaultProvider ?? pc.dim("(not set)");
  }

  const effectiveProvider = resolveProvider(undefined, config);
  const envOverrideLabel = pc.yellow(
    `(env: DOJOPS_PROVIDER=${process.env.DOJOPS_PROVIDER} → ${effectiveProvider})`,
  );
  return `${config.defaultProvider ?? pc.dim("(not set)")} ${envOverrideLabel}`;
}

function formatCopilotStatus(isProjectScope: boolean): string {
  const isAuthenticated = !isProjectScope && isCopilotAuthenticated();
  return isAuthenticated
    ? pc.green("authenticated") + " " + pc.dim("(OAuth)")
    : pc.dim("(not set)");
}

function collectEnvTokenLines(): string[] {
  const envVars: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    mistral: "MISTRAL_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envLines: string[] = [];
  for (const [provider, envKey] of Object.entries(envVars)) {
    if (process.env[envKey]) {
      envLines.push(`  ${provider}: ${maskToken(process.env[envKey])} ${pc.dim("(env)")}`);
    }
  }
  return envLines;
}

function buildConfigTitle(scopePath: string | undefined, isProjectScope: boolean): string {
  const activePath = scopePath ?? getConfigPath();
  const isLocal = activePath !== getGlobalConfigPath();
  const scopeBadge = isLocal ? pc.green("[project]") : "";
  const activeProfile = getActiveProfile();
  const configPathDim = pc.dim(`(${activePath})`);
  const profileBadge =
    !isProjectScope && activeProfile ? pc.yellow(`[profile: ${activeProfile}]`) : "";
  const badges = [scopeBadge, profileBadge].filter(Boolean).join(" ");
  return `Configuration ${configPathDim}${badges ? " " + badges : ""}`;
}

function showConfig(config: DojOpsConfig, scopePath?: string): void {
  const isProjectScope = scopePath !== undefined && scopePath !== getGlobalConfigPath();

  const lines = [
    `${pc.bold("Provider:")}  ${formatProviderDisplay(config, isProjectScope)}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Temperature:")} ${config.defaultTemperature == null ? pc.dim("(not set)") : String(config.defaultTemperature)}`,
    `${pc.bold("Ollama host:")} ${config.ollamaHost ?? pc.dim("(default)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:          ${maskToken(config.tokens?.openai)}`,
    `  anthropic:       ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:        ${maskToken(config.tokens?.deepseek)}`,
    `  mistral:         ${maskToken(config.tokens?.mistral)}`,
    `  gemini:          ${maskToken(config.tokens?.gemini)}`,
    `  ollama:          ${pc.dim("(no token needed)")}`,
    `  github-copilot:  ${formatCopilotStatus(isProjectScope)}`,
  ];

  if (!isProjectScope) {
    const envLines = collectEnvTokenLines();
    if (envLines.length > 0) {
      lines.push(`${pc.bold("Env tokens:")}`, ...envLines);
    }
  }

  const title = buildConfigTitle(scopePath, isProjectScope);
  p.note(lines.join("\n"), truncateNoteTitle(title));
}

function handleShowSubcommand(ctx: CLIContext): void {
  const config = loadConfig();
  if (ctx.globalOpts.output === "json") {
    const safeConfig = {
      ...config,
      tokens: Object.fromEntries(
        Object.entries(config.tokens ?? {}).map(([k, v]) => [k, v ? "***" : null]),
      ),
    };
    console.log(JSON.stringify(safeConfig, null, 2));
  } else {
    showConfig(config);
  }
}

async function handleResetSubcommand(ctx: CLIContext): Promise<void> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    p.log.info("No configuration file to reset.");
    return;
  }

  if (!ctx.globalOpts.nonInteractive) {
    const confirmed = await p.confirm({
      message: `Delete configuration at ${configPath}?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      return;
    }
  }

  fs.unlinkSync(configPath);
  p.log.success("Configuration reset successfully.");
}

function applyProviderFlag(config: DojOpsConfig, providerFlag: string): void {
  try {
    validateProvider(providerFlag);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }
  config.defaultProvider = providerFlag;
}

function applyTokenFlag(
  config: DojOpsConfig,
  tokenFlag: string,
  providerFlag: string | undefined,
): void {
  const provider = providerFlag ?? config.defaultProvider ?? "openai";
  if (provider === "ollama" || provider === "github-copilot") {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      provider === "ollama"
        ? "Ollama runs locally and does not require an API token."
        : "GitHub Copilot uses OAuth Device Flow. Run: dojops auth login --provider github-copilot",
    );
  }
  config.tokens = config.tokens ?? {};
  config.tokens[provider] = tokenFlag;
}

function applyTemperatureFlag(config: DojOpsConfig, temperatureFlag: string): void {
  const temp = Number.parseFloat(temperatureFlag);
  if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Temperature must be a number between 0 and 2.");
  }
  config.defaultTemperature = temp;
}

function handleDirectFlags(
  config: DojOpsConfig,
  providerFlag: string | undefined,
  tokenFlag: string | undefined,
  modelFlag: string | undefined,
  temperatureFlag: string | undefined,
): void {
  if (providerFlag) applyProviderFlag(config, providerFlag);
  if (tokenFlag) applyTokenFlag(config, tokenFlag, providerFlag);
  if (modelFlag) config.defaultModel = modelFlag;
  if (temperatureFlag) applyTemperatureFlag(config, temperatureFlag);

  saveConfig(config);
  p.log.success("Configuration saved.");
  showConfig(config);
}

async function ensureCopilotAuth(provider: string): Promise<void> {
  if (provider !== "github-copilot" || isCopilotAuthenticated()) return;

  const cs = p.spinner();
  cs.start("Starting GitHub Copilot OAuth Device Flow...");
  await copilotLogin({
    onDeviceCode: (userCode, verificationUri) => {
      cs.stop("Device code received.");
      p.note(
        [
          `Code: ${pc.bold(pc.cyan(userCode))}`,
          `URL:  ${pc.underline(verificationUri)}`,
          "",
          "Open the URL above and paste the code to authorize DojOps.",
        ].join("\n"),
        "GitHub Device Authorization",
      );
      cs.start("Waiting for authorization...");
    },
    onStatus: (msg) => cs.message(msg),
  });
  cs.stop("Authenticated with GitHub Copilot.");
}

async function fetchAndSelectModel(
  provider: string,
  token: string | undefined,
  ollamaHost: string | undefined,
  ollamaTls: boolean | undefined,
  config: DojOpsConfig,
  modelSuggestions: Record<string, string>,
  isStructured: boolean,
): Promise<string | symbol | null> {
  if (!token && provider !== "ollama" && provider !== "github-copilot") return null;

  try {
    const s = p.spinner();
    if (!isStructured) s.start("Fetching available models...");
    const llm = createProvider({
      provider,
      apiKey: token || undefined,
      ollamaHost,
      ollamaTlsRejectUnauthorized: ollamaTls === false ? false : undefined,
    });
    const models = await llm.listModels?.();
    if (!isStructured) s.stop("Models fetched.");

    if (!models?.length) return null;

    const customValue = "__custom__";
    const choice = await p.select({
      message: "Select default model:",
      options: [
        ...models.map((m) => ({ value: m, label: m })),
        { value: customValue, label: "Custom model..." },
      ],
      initialValue: config.defaultModel ?? models[0],
    });

    if (choice !== customValue) return choice as string;

    return p.text({
      message: "Enter custom model name:",
      placeholder: modelSuggestions[provider] ?? "",
      defaultValue: config.defaultModel ?? "",
    });
  } catch {
    return null;
  }
}

function applyOllamaSettings(config: DojOpsConfig, answers: Record<string, unknown>): void {
  const host = answers.ollamaHost as string;
  if (host && host !== "http://localhost:11434") {
    config.ollamaHost = host;
  } else {
    delete config.ollamaHost;
  }
  const tls = answers.ollamaTls;
  if (tls === false) {
    config.ollamaTlsRejectUnauthorized = false;
  } else {
    delete config.ollamaTlsRejectUnauthorized;
  }
}

async function updateDefaultProvider(
  config: DojOpsConfig,
  chosenProvider: string,
  nonInteractive: boolean,
): Promise<void> {
  if (!config.defaultProvider) {
    config.defaultProvider = chosenProvider;
    return;
  }
  if (config.defaultProvider === chosenProvider) return;
  if (nonInteractive) return;

  const switchDefault = await p.confirm({
    message: `Default provider is currently ${pc.bold(config.defaultProvider)}. Switch default to ${pc.bold(chosenProvider)}?`,
    initialValue: false,
  });
  if (!p.isCancel(switchDefault) && switchDefault) {
    config.defaultProvider = chosenProvider;
  }
}

async function offerAdditionalProvider(
  config: DojOpsConfig,
  chosenProvider: string,
  savePath?: string,
): Promise<void> {
  const unconfigured = VALID_PROVIDERS.filter(
    (prov) =>
      prov !== "ollama" &&
      prov !== "github-copilot" &&
      prov !== chosenProvider &&
      !config.tokens?.[prov],
  );
  if (unconfigured.length === 0) return;

  const addAnother = await p.confirm({
    message: "Configure another provider?",
    initialValue: false,
  });
  if (p.isCancel(addAnother) || !addAnother) return;

  const nextProvider = await p.select({
    message: "Select provider:",
    options: unconfigured.map((v) => ({ value: v, label: v })),
  });
  if (p.isCancel(nextProvider)) return;

  const nextToken = await p.password({
    message: `API key for ${nextProvider}:`,
  });
  if (p.isCancel(nextToken) || !nextToken) return;

  config.tokens = config.tokens ?? {};
  config.tokens[nextProvider as string] = nextToken as string;
  saveConfig(config, savePath);
  p.log.success(`Token saved for ${pc.bold(nextProvider as string)}.`);
}

function handleGetSubcommand(args: string[]): void {
  const key = args[1];
  if (!key) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config get <key>");
  }

  const config = loadConfig();
  const value = getNestedValue(config, key);

  if (value === undefined) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Config key "${key}" is not set.`);
  }

  // Mask token values by default
  if (key.startsWith("tokens.") && typeof value === "string") {
    console.log(maskToken(value));
  } else if (typeof value === "object" && value !== null) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value),
    );
  }
}

function handleSetSubcommand(args: string[]): void {
  const key = args[1];
  const value = args.slice(2).join(" ");
  if (!key || !value) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config set <key> <value>");
  }
  if (value.startsWith("--")) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid value "${value}". To remove a key, use: dojops config delete <key>`,
    );
  }

  const config = loadConfig();
  setNestedValue(config, key, value);
  saveConfig(config);
  p.log.success(`Set ${pc.bold(key)} = ${key.startsWith("tokens.") ? maskToken(value) : value}`);
}

function handleDeleteSubcommand(args: string[]): void {
  const key = args[1];
  if (!key) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config delete <key>");
  }

  const config = loadConfig();
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Config key "${key}" is not set.`);
    }
    current = current[parts[i]];
  }
  const lastKey = parts.at(-1)!;
  if (!(lastKey in current)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Config key "${key}" is not set.`);
  }
  delete current[lastKey];
  saveConfig(config);
  p.log.success(`Deleted ${pc.bold(key)}`);
}

/** @internal exported for testing */
export function validateConfigValues(config: DojOpsConfig): string[] {
  const issues: string[] = [];

  if (config.defaultProvider && !VALID_PROVIDERS.includes(config.defaultProvider as never)) {
    issues.push(`Invalid provider: "${config.defaultProvider}"`);
  }

  if (
    config.defaultTemperature != null &&
    (config.defaultTemperature < 0 || config.defaultTemperature > 2)
  ) {
    issues.push(`Temperature out of range: ${config.defaultTemperature} (must be 0-2)`);
  }

  if (config.ollamaHost) {
    try {
      const u = new URL(config.ollamaHost);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        issues.push(`Ollama host must use http:// or https://: "${config.ollamaHost}"`);
      }
    } catch {
      issues.push(`Invalid Ollama host URL: "${config.ollamaHost}"`);
    }
  }

  return issues;
}

/** @internal exported for testing */
export function validateConfigPermissions(configPath: string): string[] {
  try {
    const stat = fs.statSync(configPath);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== "600") {
      return [`Insecure file permissions: ${mode} (should be 600)`];
    }
  } catch {
    return ["Could not check file permissions"];
  }
  return [];
}

function handleValidateSubcommand(): void {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    p.log.error(`Config file not found: ${configPath}`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No config file. Run: dojops config");
  }

  const config = loadConfig();
  const issues = [...validateConfigValues(config), ...validateConfigPermissions(configPath)];

  if (issues.length > 0) {
    for (const issue of issues) {
      p.log.warn(`${pc.yellow("!")} ${issue}`);
    }
    throw new CLIError(ExitCode.VALIDATION_ERROR, `${issues.length} validation issue(s) found.`);
  }

  p.log.success("Configuration is valid.");
}

function getNestedValue(obj: DojOpsConfig, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: DojOpsConfig, dotPath: string, raw: string): void {
  const parts = dotPath.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  const key = parts.at(-1)!;

  // Validate known keys
  if (dotPath === "defaultProvider") {
    validateProvider(raw);
  }
  if (dotPath === "defaultTemperature") {
    const t = Number.parseFloat(raw);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, "Temperature must be between 0 and 2.");
    }
    current[key] = t;
    return;
  }
  if (dotPath === "ollamaTlsRejectUnauthorized") {
    current[key] = raw !== "false" && raw !== "0";
    return;
  }
  current[key] = raw;
}

function handleAliasSubcommand(args: string[]): void {
  const sub = args[1];

  // dojops config alias (no sub) — list aliases
  if (!sub) {
    const config = loadConfig();
    const aliases = config.aliases ?? {};
    if (Object.keys(aliases).length === 0) {
      p.log.info("No model aliases configured.");
      p.log.info(pc.dim("Set one with: dojops config alias <name> <model-id>"));
      return;
    }
    const lines = Object.entries(aliases).map(
      ([name, target]) => `  ${pc.cyan(name.padEnd(16))} → ${target}`,
    );
    p.note(lines.join("\n"), "Model Aliases");
    return;
  }

  // dojops config alias remove <name>
  if (sub === "remove" || sub === "delete") {
    const name = args[2];
    if (!name) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config alias remove <name>");
    }
    const config = loadConfig();
    if (!config.aliases?.[name]) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Alias "${name}" not found.`);
    }
    delete config.aliases[name];
    if (Object.keys(config.aliases).length === 0) delete config.aliases;
    saveConfig(config);
    p.log.success(`Removed alias ${pc.bold(name)}`);
    return;
  }

  // dojops config alias <name> <model-id>
  const name = sub;
  const target = args.slice(2).join(" ");
  if (!target) {
    // Show single alias
    const config = loadConfig();
    const resolved = config.aliases?.[name];
    if (resolved) {
      console.log(resolved);
    } else {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Alias "${name}" not found.`);
    }
    return;
  }

  const config = loadConfig();
  config.aliases = config.aliases ?? {};
  config.aliases[name] = target;
  saveConfig(config);
  p.log.success(`Alias ${pc.bold(name)} → ${pc.dim(target)}`);
}

function handleBackupSubcommand(args: string[], ctx: CLIContext): void {
  const root = findProjectRoot() ?? ctx.cwd;
  const dir = dojopsDir(root);
  if (!fs.existsSync(dir)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No .dojops directory found. Run: dojops init");
  }

  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
  const outFlag = extractFlagValue(args, "--output");
  const outPath = outFlag ?? path.join(root, `dojops-backup-${timestamp}.tar.gz`);

  try {
    execFileSync("tar", ["czf", outPath, "-C", root, ".dojops"], { stdio: "pipe" });
  } catch (err) {
    throw new CLIError(ExitCode.GENERAL_ERROR, `Backup failed: ${(err as Error).message}`);
  }

  const hash = createHash("sha256").update(fs.readFileSync(outPath)).digest("hex");
  const stat = fs.statSync(outPath);
  const sizeKB = Math.round(stat.size / 1024);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ path: outPath, sha256: hash, sizeBytes: stat.size }));
  } else {
    p.log.success(`Backup created: ${pc.bold(outPath)} (${sizeKB} KB)`);
    p.log.info(`SHA-256: ${pc.dim(hash)}`);
  }
}

async function handleRestoreSubcommand(args: string[], ctx: CLIContext): Promise<void> {
  const archivePath = args[1];
  if (!archivePath) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config restore <backup.tar.gz>");
  }
  if (!fs.existsSync(archivePath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${archivePath}`);
  }

  // Verify the archive looks like a tar.gz
  if (!archivePath.endsWith(".tar.gz") && !archivePath.endsWith(".tgz")) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Expected a .tar.gz archive.");
  }

  // Verify SHA-256 if --checksum provided
  const expectedHash = extractFlagValue(args, "--checksum");
  if (expectedHash) {
    const actualHash = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
    if (actualHash !== expectedHash) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Checksum mismatch.\n  Expected: ${expectedHash}\n  Actual:   ${actualHash}`,
      );
    }
  }

  const root = findProjectRoot() ?? ctx.cwd;
  const dir = dojopsDir(root);

  if (!ctx.globalOpts.nonInteractive && fs.existsSync(dir)) {
    const confirmed = await p.confirm({
      message: `This will overwrite ${dir}. Continue?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.info("Cancelled.");
      return;
    }
  }

  try {
    execFileSync("tar", ["xzf", archivePath, "-C", root], { stdio: "pipe" });
  } catch (err) {
    throw new CLIError(ExitCode.GENERAL_ERROR, `Restore failed: ${(err as Error).message}`);
  }

  p.log.success(`Restored from ${pc.bold(archivePath)}`);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];
    if (
      sv != null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv != null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

function handleApplySubcommand(args: string[], ctx: CLIContext): void {
  const filePath = args[1];
  if (!filePath) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config apply <config.json>");
  }
  if (!fs.existsSync(filePath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${filePath}`);
  }

  let patch: Record<string, unknown>;
  try {
    patch = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid JSON in ${filePath}`);
  }

  const config = loadConfig();
  const merged = deepMerge(config as Record<string, unknown>, patch) as DojOpsConfig;

  // Validate before saving
  const issues = validateConfigValues(merged);
  if (issues.length > 0) {
    for (const issue of issues) {
      p.log.warn(`${pc.yellow("!")} ${issue}`);
    }
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Patch validation failed: ${issues.length} issue(s).`,
    );
  }

  if (ctx.globalOpts.dryRun) {
    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify(merged, null, 2));
    } else {
      p.log.info("Dry run — merged config:");
      showConfig(merged);
    }
    return;
  }

  saveConfig(merged);
  p.log.success(`Applied config patch from ${pc.bold(filePath)}`);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(merged, null, 2));
  } else {
    showConfig(merged);
  }
}

function handleExportSubcommand(args: string[]): void {
  const config = loadConfig();
  // Mask tokens in export unless --reveal is used
  const reveal = hasFlag(args, "--reveal");
  const safe = reveal
    ? config
    : {
        ...config,
        tokens: config.tokens
          ? Object.fromEntries(Object.entries(config.tokens).map(([k, v]) => [k, v ? "***" : null]))
          : undefined,
      };

  const outPath = args[1];
  if (outPath && outPath !== "--reveal") {
    fs.writeFileSync(outPath, JSON.stringify(safe, null, 2) + "\n");
    p.log.success(`Config exported to ${pc.bold(outPath)}`);
  } else {
    console.log(JSON.stringify(safe, null, 2));
  }
}

async function dispatchSubcommand(args: string[], ctx: CLIContext): Promise<boolean> {
  switch (args[0]) {
    case "show":
      handleShowSubcommand(ctx);
      return true;
    case "get":
      handleGetSubcommand(args);
      return true;
    case "set":
      handleSetSubcommand(args);
      return true;
    case "delete":
    case "unset":
      handleDeleteSubcommand(args);
      return true;
    case "validate":
      handleValidateSubcommand();
      return true;
    case "reset":
      await handleResetSubcommand(ctx);
      return true;
    case "alias":
      handleAliasSubcommand(args);
      return true;
    case "backup":
      handleBackupSubcommand(args, ctx);
      return true;
    case "restore":
      await handleRestoreSubcommand(args, ctx);
      return true;
    case "apply":
      handleApplySubcommand(args, ctx);
      return true;
    case "export":
      handleExportSubcommand(args);
      return true;
    case "profile": {
      const { configProfileCommand } = await import("./config-profile");
      await configProfileCommand(args.slice(1), ctx);
      return true;
    }
    default:
      return false;
  }
}

async function promptConfigScope(
  ctx: CLIContext,
  globalPath: string,
  effectiveLocalPath: string,
): Promise<"global" | "local"> {
  if (ctx.globalOpts.nonInteractive) return "global";

  const globalLabel = pc.dim(`(${globalPath})`);
  const localLabel = pc.dim(`(${effectiveLocalPath})`);
  const scopeChoice = await p.select({
    message: "Where should configuration be saved?",
    options: [
      {
        value: "global",
        label: `Global ${globalLabel}`,
        hint: "applies to all projects",
      },
      {
        value: "local",
        label: `Project ${localLabel}`,
        hint: "applies to this project only",
      },
    ],
    initialValue: "global" as string,
  });
  if (p.isCancel(scopeChoice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return scopeChoice as "global" | "local";
}

function applyInteractiveAnswers(config: DojOpsConfig, answers: Record<string, unknown>): void {
  const chosenProvider = answers.provider as string;
  if (answers.token) {
    config.tokens = config.tokens ?? {};
    config.tokens[chosenProvider] = answers.token as string;
  }
  if (answers.model) {
    config.defaultModel = answers.model as string;
  }
  if (chosenProvider === "ollama") {
    applyOllamaSettings(config, answers);
  }
}

export async function configCommand(args: string[], ctx: CLIContext): Promise<void> {
  const dispatched = await dispatchSubcommand(args, ctx);
  if (dispatched) return;

  const providerFlag = extractFlagValue(args, "--provider") ?? ctx.globalOpts.provider;
  const tokenFlag = extractFlagValue(args, "--token");
  const modelFlag = extractFlagValue(args, "--model") ?? ctx.globalOpts.model;
  const temperatureFlag = extractFlagValue(args, "--temperature");

  if (providerFlag || tokenFlag || modelFlag || temperatureFlag) {
    handleDirectFlags(loadConfig(), providerFlag, tokenFlag, modelFlag, temperatureFlag);
    return;
  }

  // Interactive mode
  p.intro(pc.bgCyan(pc.black(" dojops config ")));

  const localPath = getLocalConfigPath();
  const globalPath = getGlobalConfigPath();
  const effectiveLocalPath = localPath ?? path.join(process.cwd(), ".dojops", "config.json");

  const configScope = await promptConfigScope(ctx, globalPath, effectiveLocalPath);

  const savePath = configScope === "local" ? effectiveLocalPath : undefined;
  const config: DojOpsConfig =
    configScope === "local" ? readConfigFile(effectiveLocalPath) : loadConfig();

  if (config.defaultProvider || config.defaultModel || config.tokens) {
    showConfig(config, savePath);
  }

  const modelSuggestions: Record<string, string> = {
    openai: "e.g. gpt-4o, gpt-4o-mini",
    anthropic: "e.g. claude-sonnet-4-5-20250929",
    ollama: "e.g. llama3, mistral, codellama",
    deepseek: "e.g. deepseek-chat, deepseek-reasoner",
    mistral: "e.g. mistral-large-latest, mistral-small-latest",
    gemini: "e.g. gemini-2.5-flash, gemini-2.5-pro",
    "github-copilot": "e.g. gpt-4o, claude-3.5-sonnet, o1-mini",
  };

  const answers = await p.group(
    {
      provider: () =>
        p.select({
          message: "Select your LLM provider:",
          options: VALID_PROVIDERS.map((v) => ({ value: v, label: v })),
          initialValue: config.defaultProvider ?? "openai",
        }),
      token: ({ results }) => {
        if (results.provider === "ollama" || results.provider === "github-copilot")
          return Promise.resolve("");
        const currentToken = config.tokens?.[results.provider!];
        const hint = currentToken ? ` [current: ${maskToken(currentToken)}]` : "";
        return p.password({
          message: `API key for ${results.provider}${hint}:`,
        });
      },
      ollamaHost: ({ results }) => {
        if (results.provider !== "ollama") return Promise.resolve("");
        return p.text({
          message: "Ollama server URL:",
          placeholder: "http://localhost:11434",
          defaultValue: config.ollamaHost ?? "http://localhost:11434",
          validate: (val) => {
            if (!val) return undefined;
            try {
              const u = new URL(val);
              if (u.protocol !== "http:" && u.protocol !== "https:") {
                return "URL must use http:// or https://";
              }
            } catch {
              return "Invalid URL";
            }
            return undefined;
          },
        });
      },
      ollamaTls: ({ results }) => {
        const host = results.ollamaHost as string;
        if (!host?.startsWith("https://")) return Promise.resolve(true);
        return p.confirm({
          message: "Verify TLS certificates? (disable for self-signed certs)",
          initialValue: config.ollamaTlsRejectUnauthorized ?? true,
        });
      },
      model: async ({ results }) => {
        const provider = results.provider as string;
        const token = (results.token as string) || config.tokens?.[provider];

        await ensureCopilotAuth(provider);

        const isStructured = ctx.globalOpts.output !== "table";
        const ollamaHost = (results.ollamaHost as string) || undefined;
        const ollamaTls = results.ollamaTls as boolean | undefined;

        const selected = await fetchAndSelectModel(
          provider,
          token,
          ollamaHost,
          ollamaTls,
          config,
          modelSuggestions,
          isStructured,
        );
        if (selected !== null) return selected;

        return p.text({
          message: "Default model (press Enter to skip):",
          placeholder: modelSuggestions[provider] ?? "",
          defaultValue: config.defaultModel ?? "",
        });
      },
    },
    {
      onCancel: () => {
        p.cancel("Cancelled.");
        process.exit(0);
      },
    },
  );

  const chosenProvider = answers.provider as string;
  applyInteractiveAnswers(config, answers);

  await updateDefaultProvider(config, chosenProvider, !!ctx.globalOpts.nonInteractive);

  saveConfig(config, savePath);
  const scopeLabel = configScope === "local" ? "project" : "global";
  p.log.success(`Configuration saved (${scopeLabel}).`);
  showConfig(config, savePath);

  if (!ctx.globalOpts.nonInteractive) {
    await offerAdditionalProvider(config, chosenProvider, savePath);
  }
}
