import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface OdaConfig {
  defaultProvider?: string;
  defaultModel?: string;
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
export function loadConfig(): OdaConfig {
  try {
    const raw = fs.readFileSync(configFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as OdaConfig;
  } catch {
    return {};
  }
}

/** Writes config to ~/.dojops/config.json. Creates directory with 0o700 and file with 0o600. */
export function saveConfig(config: OdaConfig): void {
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
export function resolveProvider(cliFlag: string | undefined, config: OdaConfig): string {
  const raw = cliFlag ?? process.env.DOJOPS_PROVIDER ?? config.defaultProvider ?? "openai";
  return validateProvider(raw);
}

/**
 * Resolves the LLM model to use.
 * Priority: CLI flag > DOJOPS_MODEL env > config defaultModel > undefined
 */
export function resolveModel(cliFlag: string | undefined, config: OdaConfig): string | undefined {
  return cliFlag ?? process.env.DOJOPS_MODEL ?? config.defaultModel ?? undefined;
}

/**
 * Resolves the API token for a given provider.
 * Priority: environment variable > config token
 * Returns undefined for ollama (no token needed).
 */
export function resolveToken(provider: string, config: OdaConfig): string | undefined {
  if (provider === "ollama") return undefined;

  const envVar = TOKEN_ENV_MAP[provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  return config.tokens?.[provider];
}

/**
 * Parses a flag value from CLI args. Supports both `--flag=value` and `--flag value` forms.
 * Returns undefined if the flag is not present.
 */
export function parseFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

// ── Profile management ─────────────────────────────────────────────

function profilesDir(): string {
  return path.join(configDir(), "profiles");
}

function metaFile(): string {
  return path.join(configDir(), "meta.json");
}

export function loadProfile(name: string): OdaConfig | null {
  const file = path.join(profilesDir(), `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as OdaConfig;
  } catch {
    return null;
  }
}

export function saveProfile(name: string, config: OdaConfig): void {
  const dir = profilesDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
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
 * Loads config with profile support.
 * Priority: explicit profile > active profile > default config
 */
export function loadProfileConfig(profileName?: string): OdaConfig {
  const name = profileName ?? getActiveProfile();
  if (name) {
    const profile = loadProfile(name);
    if (profile) return profile;
  }
  return loadConfig();
}
