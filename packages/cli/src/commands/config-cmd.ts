import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  validateProvider,
  resolveProvider,
  getActiveProfile,
  VALID_PROVIDERS,
  DojOpsConfig,
} from "../config";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { createProvider } from "@dojops/api";
import { isCopilotAuthenticated, copilotLogin } from "@dojops/core";

function showConfig(config: DojOpsConfig): void {
  // UX #10: Show effective provider (including env var override) if it differs from config
  const effectiveProvider = resolveProvider(undefined, config);
  const envOverrideLabel = pc.yellow(
    `(env: DOJOPS_PROVIDER=${process.env.DOJOPS_PROVIDER} → ${effectiveProvider})`,
  );
  const providerDisplay =
    process.env.DOJOPS_PROVIDER && process.env.DOJOPS_PROVIDER !== config.defaultProvider
      ? `${config.defaultProvider ?? pc.dim("(not set)")} ${envOverrideLabel}`
      : (config.defaultProvider ?? pc.dim("(not set)"));
  const lines = [
    `${pc.bold("Provider:")}  ${providerDisplay}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Temperature:")} ${config.defaultTemperature == null ? pc.dim("(not set)") : String(config.defaultTemperature)}`,
    `${pc.bold("Ollama host:")} ${config.ollamaHost ?? pc.dim("(default)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:          ${maskToken(config.tokens?.openai)}`,
    `  anthropic:       ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:        ${maskToken(config.tokens?.deepseek)}`,
    `  gemini:          ${maskToken(config.tokens?.gemini)}`,
    `  ollama:          ${pc.dim("(no token needed)")}`,
    `  github-copilot:  ${isCopilotAuthenticated() ? pc.green("authenticated") + " " + pc.dim("(OAuth)") : pc.dim("(not set)")}`,
  ];

  // Show environment variable tokens (not visible via config file)
  const envVars: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envLines: string[] = [];
  for (const [provider, envKey] of Object.entries(envVars)) {
    if (process.env[envKey]) {
      envLines.push(`  ${provider}: ${maskToken(process.env[envKey])} ${pc.dim("(env)")}`);
    }
  }
  if (envLines.length > 0) {
    lines.push(`${pc.bold("Env tokens:")}`, ...envLines);
  }

  const activeProfile = getActiveProfile();
  const configPathDim = pc.dim(`(${getConfigPath()})`);
  const profileBadge = activeProfile ? pc.yellow(`[profile: ${activeProfile}]`) : "";
  const title = activeProfile
    ? `Configuration ${configPathDim} ${profileBadge}`
    : `Configuration ${configPathDim}`;
  p.note(lines.join("\n"), title);
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
  saveConfig(config);
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
  } else if (typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}

function handleSetSubcommand(args: string[]): void {
  const key = args[1];
  const value = args.slice(2).join(" ");
  if (!key || !value) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops config set <key> <value>");
  }

  const config = loadConfig();
  setNestedValue(config, key, value);
  saveConfig(config);
  p.log.success(`Set ${pc.bold(key)} = ${key.startsWith("tokens.") ? maskToken(value) : value}`);
}

function handleValidateSubcommand(): void {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    p.log.error(`Config file not found: ${configPath}`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No config file. Run: dojops config");
  }

  const issues: string[] = [];
  const config = loadConfig();

  // Check provider validity
  if (config.defaultProvider && !VALID_PROVIDERS.includes(config.defaultProvider as never)) {
    issues.push(`Invalid provider: "${config.defaultProvider}"`);
  }

  // Check temperature range
  if (config.defaultTemperature != null) {
    if (config.defaultTemperature < 0 || config.defaultTemperature > 2) {
      issues.push(`Temperature out of range: ${config.defaultTemperature} (must be 0-2)`);
    }
  }

  // Check Ollama host URL
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

  // Check file permissions
  try {
    const stat = fs.statSync(configPath);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== "600") {
      issues.push(`Insecure file permissions: ${mode} (should be 600)`);
    }
  } catch {
    issues.push("Could not check file permissions");
  }

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
  const key = parts[parts.length - 1];

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

export async function configCommand(args: string[], ctx: CLIContext): Promise<void> {
  if (args[0] === "show") {
    handleShowSubcommand(ctx);
    return;
  }

  if (args[0] === "get") {
    handleGetSubcommand(args);
    return;
  }

  if (args[0] === "set") {
    handleSetSubcommand(args);
    return;
  }

  if (args[0] === "validate") {
    handleValidateSubcommand();
    return;
  }

  if (args[0] === "reset") {
    return handleResetSubcommand(ctx);
  }

  if (args[0] === "profile") {
    const { configProfileCommand } = await import("./config-profile");
    return configProfileCommand(args.slice(1), ctx);
  }

  const providerFlag = extractFlagValue(args, "--provider") ?? ctx.globalOpts.provider;
  const tokenFlag = extractFlagValue(args, "--token");
  const modelFlag = extractFlagValue(args, "--model") ?? ctx.globalOpts.model;
  const temperatureFlag = extractFlagValue(args, "--temperature");

  if (providerFlag || tokenFlag || modelFlag || temperatureFlag) {
    handleDirectFlags(loadConfig(), providerFlag, tokenFlag, modelFlag, temperatureFlag);
    return;
  }

  // Interactive mode
  const config = loadConfig();

  p.intro(pc.bgCyan(pc.black(" dojops config ")));

  if (config.defaultProvider || config.defaultModel || config.tokens) {
    showConfig(config);
  }

  const modelSuggestions: Record<string, string> = {
    openai: "e.g. gpt-4o, gpt-4o-mini",
    anthropic: "e.g. claude-sonnet-4-5-20250929",
    ollama: "e.g. llama3, mistral, codellama",
    deepseek: "e.g. deepseek-chat, deepseek-reasoner",
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

  await updateDefaultProvider(config, chosenProvider, !!ctx.globalOpts.nonInteractive);

  saveConfig(config);
  p.log.success("Configuration saved.");
  showConfig(config);

  if (!ctx.globalOpts.nonInteractive) {
    await offerAdditionalProvider(config, chosenProvider);
  }
}
