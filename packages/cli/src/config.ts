import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface DojOpsConfig {
  defaultProvider?: string;
  defaultModel?: string;
  defaultTemperature?: number;
  tokens?: Record<string, string>;
}

export const VALID_PROVIDERS = ["openai", "anthropic", "ollama", "deepseek", "gemini"] as const;
export type Provider = (typeof VALID_PROVIDERS)[number];

const TOKEN_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  gemini: "GEMINI_API_KEY",
};

function configDir(): string {
  return path.join(os.homedir(), ".dojops");
}

function configFile(): string {
  return path.join(configDir(), "config.json");
}

/** Returns the path to the config file (for display purposes). */
export function getConfigPath(): string {
  return configFile();
}

/** Loads config from ~/.dojops/config.json. Returns empty config if missing or invalid. */
export function loadConfig(): DojOpsConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as DojOpsConfig;
  } catch {
    return {};
  }
}

/** Writes config to ~/.dojops/config.json. Creates directory with 0o700 and file with 0o600. */
export function saveConfig(config: DojOpsConfig): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
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
 */
export function resolveModel(
  cliFlag: string | undefined,
  config: DojOpsConfig,
): string | undefined {
  return cliFlag ?? process.env.DOJOPS_MODEL ?? config.defaultModel ?? undefined;
}

/**
 * Resolves the LLM temperature to use.
 * Priority: CLI flag > DOJOPS_TEMPERATURE env > config defaultTemperature > undefined
 */
export function resolveTemperature(
  cliFlag: number | undefined,
  config: DojOpsConfig,
): number | undefined {
  if (cliFlag !== undefined) return cliFlag;
  const envVal = process.env.DOJOPS_TEMPERATURE;
  if (envVal !== undefined) return Number(envVal);
  return config.defaultTemperature ?? undefined;
}

/**
 * Resolves the API token for a given provider.
 * Priority: environment variable > config token
 * Returns undefined for ollama (no token needed).
 */
export function resolveToken(provider: string, config: DojOpsConfig): string | undefined {
  if (provider === "ollama") return undefined;

  const envVar = TOKEN_ENV_MAP[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  return config.tokens?.[provider];
}

// ── Profile management ─────────────────────────────────────────────

function profilesDir(): string {
  return path.join(configDir(), "profiles");
}

function metaFile(): string {
  return path.join(configDir(), "meta.json");
}

export function loadProfile(name: string): DojOpsConfig | null {
  const file = path.join(profilesDir(), `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as DojOpsConfig;
  } catch {
    return null;
  }
}

export function saveProfile(name: string, config: DojOpsConfig): void {
  const dir = profilesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function deleteProfile(name: string): boolean {
  const file = path.join(profilesDir(), `${name}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  // If this was the active profile, clear it
  const active = getActiveProfile();
  if (active === name) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
      delete meta.activeProfile;
      fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
      });
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

export function setActiveProfile(name: string): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), "utf-8"));
  } catch {
    // start fresh
  }
  meta.activeProfile = name;
  fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
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
