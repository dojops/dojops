import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isCopilotAuthenticated } from "@dojops/core";
import { mkdirOwnerOnly, writeFileOwnerOnly } from "./secure-fs";
import { encryptTokens, decryptTokens } from "./vault";

export interface ModelRoutingRule {
  match: "simple" | "complex" | "code" | "review" | "analysis";
  model: string;
  provider?: string;
}

export interface ModelRoutingConfig {
  enabled: boolean;
  rules: ModelRoutingRule[];
}

export interface DojOpsConfig {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  tokens?: Record<string, string>;
  /** Model aliases: friendly name -> provider/model ID (e.g. "fast" -> "gpt-4o-mini") */
  aliases?: Record<string, string>;
  ollamaHost?: string;
  ollamaTlsRejectUnauthorized?: boolean;
  /** Auto model routing: route prompts to different models by complexity. */
  modelRouting?: ModelRoutingConfig;
}

export const VALID_PROVIDERS = [
  "openai",
  "anthropic",
  "ollama",
  "deepseek",
  "mistral",
  "gemini",
  "github-copilot",
] as const;
export type Provider = (typeof VALID_PROVIDERS)[number];

const TOKEN_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  gemini: "GEMINI_API_KEY",
  "github-copilot": "GITHUB_COPILOT_TOKEN",
};

function globalConfigDir(): string {
  return path.join(os.homedir(), ".dojops");
}

function globalConfigFile(): string {
  return path.join(globalConfigDir(), "config.json");
}

/**
 * Find the local project config path by walking up from cwd to find .dojops/config.json.
 * Skips the global config directory (~/.dojops) to avoid self-merge.
 * Returns the path only if the file actually exists, or null.
 */
function findLocalConfigFile(): string | null {
  const globalDir = globalConfigDir();
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const dojopsDir = path.join(dir, ".dojops");
    // Skip the global config directory (~/.dojops)
    if (dojopsDir !== globalDir) {
      const candidate = path.join(dojopsDir, "config.json");
      if (fs.existsSync(candidate)) return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** Returns the path to the active config file (local if exists, else global). */
export function getConfigPath(): string {
  const local = findLocalConfigFile();
  if (local && fs.existsSync(local)) return local;
  return globalConfigFile();
}

/**
 * Returns the path to the local project config, or null if no .dojops/ directory.
 * Unlike findLocalConfigFile, this returns a path even if config.json doesn't exist yet,
 * as long as a .dojops/ directory is found (for saving new local configs).
 */
export function getLocalConfigPath(): string | null {
  const globalDir = globalConfigDir();
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const dojopsDir = path.join(dir, ".dojops");
    if (dojopsDir !== globalDir && fs.existsSync(dojopsDir)) {
      return path.join(dojopsDir, "config.json");
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** Returns the path to the global config file. */
export function getGlobalConfigPath(): string {
  return globalConfigFile();
}

/** Reads and parses a single config file. Returns empty config if missing or invalid. */
export function readConfigFile(filePath: string): DojOpsConfig {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    checkConfigPermissions(filePath);
    const config = parsed as DojOpsConfig;
    // Decrypt tokens transparently on read
    if (config.tokens) {
      config.tokens = decryptTokens(config.tokens);
      // G-03: Re-encrypt tokens migrated from legacy machine-derived key
      if (Object.getOwnPropertyDescriptor(config.tokens, "_needsReEncrypt")?.value === true) {
        try {
          saveConfig({ ...config }, filePath);
        } catch {
          // Re-encryption is best-effort — don't block startup
        }
      }
    }
    return config;
  } catch {
    return {};
  }
}

/**
 * Loads config with local > global merge.
 * Local project config (.dojops/config.json) overrides global (~/.dojops/config.json).
 * Tokens from both sources are merged (local takes precedence per-provider).
 */
export function loadConfig(): DojOpsConfig {
  const global = readConfigFile(globalConfigFile());
  const localPath = findLocalConfigFile();
  if (!localPath) return global;

  const local = readConfigFile(localPath);
  // Only merge if the local config has any keys (readConfigFile returns {} on error/missing)
  if (Object.keys(local).length === 0) return global;

  return {
    ...global,
    ...Object.fromEntries(Object.entries(local).filter(([, v]) => v !== undefined)),
    tokens: { ...global.tokens, ...local.tokens },
  };
}

/**
 * H-13: Checks file permissions and warns if group or other users have read access.
 * Only effective on POSIX systems (Linux/macOS); silently skips on Windows.
 * Uses a module-level flag to only warn once per process.
 */
let permissionWarningShown = false;

function checkConfigPermissions(filePath: string): void {
  if (permissionWarningShown) return;
  try {
    const stat = fs.statSync(filePath);
    const groupOtherBits = stat.mode & 0o077;
    if (groupOtherBits !== 0) {
      permissionWarningShown = true;
      const octal = "0o" + stat.mode.toString(8);
      console.warn(
        `Warning: config file ${filePath} is readable by other users (mode ${octal}). Consider: chmod 600 ${filePath}`,
      );
    }
  } catch {
    // statSync failed (e.g., file just deleted) — ignore
  }
}

/**
 * Writes config to the specified path, or defaults to ~/.dojops/config.json.
 * Creates directory with 0o700 and file with 0o600.
 * Tokens are encrypted at rest using AES-256-GCM.
 */
export function saveConfig(config: DojOpsConfig, targetPath?: string): void {
  const filePath = targetPath ?? globalConfigFile();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    mkdirOwnerOnly(dir);
  }
  // Encrypt tokens before writing to disk
  const toWrite = config.tokens ? { ...config, tokens: encryptTokens(config.tokens) } : config;
  writeFileOwnerOnly(filePath, JSON.stringify(toWrite, null, 2) + "\n");
}

/** Validates that a provider name is supported. Throws with a clear message if not. */
export function validateProvider(name: string): Provider {
  if (!VALID_PROVIDERS.includes(name as Provider)) {
    throw new Error(`Unknown provider "${name}". Supported: ${VALID_PROVIDERS.join(", ")}`);
  }
  return name as Provider;
}

/**
 * Resolves the LLM provider to use.
 * Priority: CLI flag > DOJOPS_PROVIDER env > config defaultProvider > "openai"
 */
export function resolveProvider(cliFlag: string | undefined, config: DojOpsConfig): string {
  const raw = cliFlag ?? process.env.DOJOPS_PROVIDER ?? config.defaultProvider ?? "openai";
  return validateProvider(raw);
}

/**
 * Resolves the LLM model to use.
 * Priority: CLI flag > DOJOPS_MODEL env > config defaultModel > undefined
 * If the resolved value matches a model alias, it is expanded to the target model ID.
 */
export function resolveModel(
  cliFlag: string | undefined,
  config: DojOpsConfig,
): string | undefined {
  const raw = cliFlag ?? process.env.DOJOPS_MODEL ?? config.defaultModel ?? undefined;
  if (!raw) return undefined;
  return resolveAlias(raw, config);
}

/** Resolve a model alias to its target. Returns the original value if no alias matches. */
export function resolveAlias(model: string, config: DojOpsConfig): string {
  return config.aliases?.[model] ?? model;
}

/**
 * Resolves the LLM temperature to use.
 * Priority: CLI flag > DOJOPS_TEMPERATURE env > config defaultTemperature > 0.2
 */
export function resolveTemperature(
  cliFlag: number | undefined,
  config: DojOpsConfig,
): number | undefined {
  if (cliFlag !== undefined) return cliFlag;
  const envVal = process.env.DOJOPS_TEMPERATURE;
  if (envVal !== undefined) {
    const parsed = Number(envVal);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
      console.warn(`[dojops] Invalid DOJOPS_TEMPERATURE="${envVal}", ignoring.`);
    } else {
      return parsed;
    }
  }
  return config.defaultTemperature ?? 0.2;
}

/**
 * Resolves the Ollama server URL.
 * Priority: CLI flag > OLLAMA_HOST env > config ollamaHost > "http://localhost:11434"
 */
export function resolveOllamaHost(cliFlag: string | undefined, config: DojOpsConfig): string {
  return cliFlag ?? process.env.OLLAMA_HOST ?? config.ollamaHost ?? "http://localhost:11434";
}

/**
 * Resolves the Ollama TLS certificate verification setting.
 * Priority: CLI flag > DOJOPS_DANGER_DISABLE_TLS_VERIFY env > OLLAMA_TLS_REJECT_UNAUTHORIZED env > config > true
 *
 * G-22: Accepts both DOJOPS_DANGER_DISABLE_TLS_VERIFY (new, recommended) and
 * OLLAMA_TLS_REJECT_UNAUTHORIZED (legacy, backward compatible).
 * Logs a prominent warning when TLS verification is disabled.
 */
export function resolveOllamaTls(cliFlag: boolean | undefined, config: DojOpsConfig): boolean {
  if (cliFlag !== undefined) {
    if (!cliFlag) warnTlsDisabled("CLI flag");
    return cliFlag;
  }

  // New env var (takes precedence): DOJOPS_DANGER_DISABLE_TLS_VERIFY
  const dangerEnv = process.env.DOJOPS_DANGER_DISABLE_TLS_VERIFY;
  if (dangerEnv !== undefined) {
    const disabled = dangerEnv === "1" || dangerEnv.toLowerCase() === "true";
    if (disabled) {
      warnTlsDisabled("DOJOPS_DANGER_DISABLE_TLS_VERIFY");
      return false;
    }
    return true;
  }

  // Legacy env var: OLLAMA_TLS_REJECT_UNAUTHORIZED
  const envVal = process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED;
  if (envVal !== undefined) {
    const rejectUnauthorized = envVal !== "0" && envVal.toLowerCase() !== "false";
    if (!rejectUnauthorized) warnTlsDisabled("OLLAMA_TLS_REJECT_UNAUTHORIZED");
    return rejectUnauthorized;
  }

  const configVal = config.ollamaTlsRejectUnauthorized ?? true;
  if (!configVal) warnTlsDisabled("config.ollamaTlsRejectUnauthorized");
  return configVal;
}

let tlsWarningShown = false;
function warnTlsDisabled(source: string): void {
  if (tlsWarningShown) return;
  tlsWarningShown = true;
  console.warn(
    `\x1b[33m[SECURITY WARNING]\x1b[0m TLS certificate verification disabled via ${source}. ` +
      "LLM traffic is vulnerable to man-in-the-middle attacks. " +
      "Only use this for local development with self-signed certificates.",
  );
}

/**
 * Resolves the API token for a given provider.
 * Priority: environment variable > config token
 * Returns undefined for ollama (no token needed).
 */
export function resolveToken(provider: string, config: DojOpsConfig): string | undefined {
  if (provider === "ollama" || provider === "github-copilot") return undefined;

  const envVar = TOKEN_ENV_MAP[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  return config.tokens?.[provider];
}

// ── Profile management ─────────────────────────────────────────────

function profilesDir(): string {
  return path.join(globalConfigDir(), "profiles");
}

function metaFile(): string {
  return path.join(globalConfigDir(), "meta.json");
}

const SAFE_PROFILE_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function validateProfileName(name: string): void {
  if (!SAFE_PROFILE_NAME.test(name)) {
    throw new Error(
      `Invalid profile name: "${name}". Only alphanumeric, dash, and underscore allowed (max 64 chars).`,
    );
  }
}

export function loadProfile(name: string): DojOpsConfig | null {
  validateProfileName(name);
  const file = path.join(profilesDir(), `${name}.json`);
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf-8")) as DojOpsConfig;
    if (config.tokens) {
      config.tokens = decryptTokens(config.tokens);
    }
    return config;
  } catch {
    return null;
  }
}

export function saveProfile(name: string, config: DojOpsConfig): void {
  validateProfileName(name);
  const dir = profilesDir();
  if (!fs.existsSync(dir)) {
    mkdirOwnerOnly(dir);
  }
  const toWrite = config.tokens ? { ...config, tokens: encryptTokens(config.tokens) } : config;
  writeFileOwnerOnly(path.join(dir, `${name}.json`), JSON.stringify(toWrite, null, 2) + "\n");
}

export function deleteProfile(name: string): boolean {
  validateProfileName(name);
  const file = path.join(profilesDir(), `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  // If this was the active profile, clear it
  const active = getActiveProfile();
  if (active === name) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
      delete meta.activeProfile;
      writeFileOwnerOnly(metaFile(), JSON.stringify(meta, null, 2) + "\n");
    } catch {
      // no meta file, nothing to clear
    }
  }
  return true;
}

export function listProfiles(): string[] {
  const dir = profilesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export function getActiveProfile(): string | undefined {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
    return meta.activeProfile;
  } catch {
    return undefined;
  }
}

export function setActiveProfile(name: string | undefined): void {
  const dir = globalConfigDir();
  if (!fs.existsSync(dir)) {
    mkdirOwnerOnly(dir);
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
  } catch {
    // start fresh
  }
  meta.activeProfile = name;
  writeFileOwnerOnly(metaFile(), JSON.stringify(meta, null, 2) + "\n");
}

/**
 * Returns provider names that have tokens configured (+ always includes "ollama").
 */
export function getConfiguredProviders(config: DojOpsConfig): string[] {
  const set = new Set<string>();
  if (config.tokens) {
    for (const [name, token] of Object.entries(config.tokens)) {
      if (token) set.add(name);
    }
  }
  set.add("ollama");
  if (isCopilotAuthenticated()) set.add("github-copilot");
  return [...set];
}

/**
 * Loads config with profile support.
 * Priority: explicit profile > active profile > default config
 */
export function loadProfileConfig(profileName?: string): DojOpsConfig {
  const name = profileName ?? getActiveProfile();
  if (name) {
    const profile = loadProfile(name);
    if (profile) return profile;
  }
  return loadConfig();
}
