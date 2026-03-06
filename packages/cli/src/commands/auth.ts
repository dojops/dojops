import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  validateProvider,
  resolveProvider,
} from "../config";
import { createProvider } from "@dojops/api";
import { copilotLogin, clearCopilotAuth, isCopilotAuthenticated } from "@dojops/core";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { maskToken } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";

export async function authCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "login":
      return authLogin(args.slice(1), ctx);
    case "status":
      return authStatus();
    case "logout":
      return authLogout(args.slice(1), ctx);
    default:
      // If no subcommand, treat as login (dojops auth --token ...)
      return authLogin(args, ctx);
  }
}

async function authLogin(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const providerFlag = extractFlagValue(args, "--provider");
  const provider = providerFlag ?? ctx.globalOpts.provider ?? config.defaultProvider ?? "openai";

  try {
    validateProvider(provider);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }

  if (provider === "github-copilot") {
    return copilotLoginFlow();
  }

  const token = extractFlagValue(args, "--token");
  if (!token) {
    p.log.warn('Tip: Use "dojops config" for interactive setup, or provide --token:');
    p.log.info(`  ${pc.dim("$")} dojops auth login --token <API_KEY>`);
    p.log.info(`  ${pc.dim("$")} dojops config`);
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  if (provider === "ollama") {
    p.log.info(
      pc.dim(
        'Ollama does not require an API token. Use "dojops config" to configure the Ollama server URL.',
      ),
    );
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Ollama runs locally and does not require an API token.",
    );
  }

  // Validate the token before saving by attempting a lightweight provider call
  try {
    const testProvider = createProvider({ provider, apiKey: token });
    if (testProvider.listModels) {
      await Promise.race([
        testProvider.listModels(),
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 5000)),
      ]);
      p.log.success("Token validated — provider connection verified.");
    }
  } catch {
    p.log.warn("Could not verify token online. Saving anyway — it may be invalid.");
  }

  config.tokens = config.tokens ?? {};
  config.tokens[provider] = token;

  if (!config.defaultProvider) {
    config.defaultProvider = provider;
  }

  saveConfig(config);

  p.log.success("Token saved successfully.");

  const isDefault = config.defaultProvider === provider;
  const firstProviderSuffix = providerFlag ? "" : " (first configured provider)";
  const defaultNote = isDefault
    ? `${pc.bold("Default:")}  ${pc.cyan("yes")}${firstProviderSuffix}`
    : `${pc.bold("Default:")}  no (default is ${pc.bold(config.defaultProvider ?? "")})`;

  const noteLines = [
    `${pc.bold("Provider:")} ${provider}`,
    `${pc.bold("Config:")}   ${pc.dim(getConfigPath())}`,
    defaultNote,
  ];
  p.note(noteLines.join("\n"), "Saved");

  if (!isDefault) {
    const makeDefaultCmd = pc.cyan(`dojops provider default ${provider}`);
    p.log.info(pc.dim(`Use ${makeDefaultCmd} to make it the default.`));
  }

  p.log.warn(
    `Token stored in plaintext at ${getConfigPath()}. Ensure this file has restricted permissions.`,
  );
  p.log.info(pc.dim('You can now run: dojops "your prompt here"'));
}

async function selectCopilotModel(currentModel: string | undefined): Promise<string | undefined> {
  const ms = p.spinner();
  ms.start("Fetching available Copilot models...");
  const llm = createProvider({ provider: "github-copilot" });
  const models = await llm.listModels?.();
  ms.stop("Models fetched.");

  if (!models || models.length === 0) return undefined;

  const customValue = "__custom__";
  const choice = await p.select({
    message: "Select default model for github-copilot:",
    options: [
      ...models.map((m) => ({ value: m, label: m })),
      { value: customValue, label: "Custom model..." },
    ],
    initialValue: currentModel ?? "gpt-4o",
  });

  if (p.isCancel(choice)) return undefined;

  let model = choice as string;
  if (model === customValue) {
    const custom = await p.text({
      message: "Enter custom model name:",
      placeholder: "e.g. gpt-4o, claude-3.5-sonnet, o1-mini",
    });
    model = !p.isCancel(custom) && custom ? (custom as string) : "";
  }

  return model || undefined;
}

async function copilotLoginFlow(): Promise<void> {
  const s = p.spinner();
  s.start("Starting GitHub Copilot OAuth Device Flow...");

  const auth = await copilotLogin({
    onDeviceCode: (userCode, verificationUri) => {
      s.stop("Device code received.");
      p.note(
        [
          `Code: ${pc.bold(pc.cyan(userCode))}`,
          `URL:  ${pc.underline(verificationUri)}`,
          "",
          "Open the URL above and paste the code to authorize DojOps.",
        ].join("\n"),
        "GitHub Device Authorization",
      );
      s.start("Waiting for authorization...");
    },
    onStatus: (msg) => s.message(msg),
  });

  s.stop("Authenticated with GitHub Copilot.");

  const config = loadConfig();
  if (!config.defaultProvider) {
    config.defaultProvider = "github-copilot";
  }

  try {
    const selectedModel = await selectCopilotModel(config.defaultModel);
    if (selectedModel) {
      config.defaultModel = selectedModel;
    }
  } catch {
    // Model fetching failed — user can set model later via dojops config
  }

  saveConfig(config);

  p.note(
    [
      `Provider: github-copilot`,
      `Plan:     ${auth.copilot_plan ?? "unknown"}`,
      `API:      ${auth.api_base_url}`,
      config.defaultModel ? `Model:    ${config.defaultModel}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "Copilot Login",
  );
}

async function authLogout(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const providerFlag = extractFlagValue(args, "--provider");
  const all = args.includes("--all");

  if (all) {
    config.tokens = {};
    clearCopilotAuth();
    saveConfig(config);
    p.log.success("All tokens removed.");
    return;
  }

  const provider =
    providerFlag ?? ctx.globalOpts.provider ?? ctx.config.defaultProvider ?? "openai";

  if (provider === "github-copilot") {
    clearCopilotAuth();
    p.log.success("GitHub Copilot credentials removed.");
    return;
  }

  if (!config.tokens?.[provider]) {
    p.log.info(`No token stored for ${pc.bold(provider)}.`);
    return;
  }

  delete config.tokens[provider];
  saveConfig(config);
  p.log.success(`Token removed for ${pc.bold(provider)}.`);
}

async function authStatus(): Promise<void> {
  const config = loadConfig();

  const envVarMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };

  function tokenSource(provider: string): string {
    const envVar = envVarMap[provider];
    const hasEnv = envVar ? !!process.env[envVar] : false;
    const hasConfig = !!config.tokens?.[provider];
    if (hasEnv && hasConfig) {
      return `${maskToken(process.env[envVar])} ${pc.dim("(env + config)")}`;
    }
    if (hasEnv) {
      return `${maskToken(process.env[envVar])} ${pc.dim("(env)")}`;
    }
    if (hasConfig) {
      return `${maskToken(config.tokens?.[provider])} ${pc.dim("(config)")}`;
    }
    return pc.dim("(not set)");
  }

  const copilotStatus = isCopilotAuthenticated()
    ? pc.green("authenticated") + " " + pc.dim("(OAuth)")
    : pc.dim("(not set)");

  // UX #3: Show effective provider including env var
  const effectiveProvider = resolveProvider(undefined, config);
  const envProviderLabel = pc.dim(`(env: DOJOPS_PROVIDER=${process.env.DOJOPS_PROVIDER})`);
  const providerDisplay =
    process.env.DOJOPS_PROVIDER && process.env.DOJOPS_PROVIDER !== config.defaultProvider
      ? `${effectiveProvider} ${envProviderLabel}`
      : (config.defaultProvider ?? pc.dim("(not set)"));
  const lines = [
    `${pc.bold("Provider:")}  ${providerDisplay}`,
    `${pc.bold("Tokens:")}`,
    `  openai:          ${tokenSource("openai")}`,
    `  anthropic:       ${tokenSource("anthropic")}`,
    `  deepseek:        ${tokenSource("deepseek")}`,
    `  gemini:          ${tokenSource("gemini")}`,
    `  ollama:          ${pc.dim("(local, no token needed)")}`,
    `  github-copilot:  ${copilotStatus}`,
  ];
  p.note(lines.join("\n"), "Auth Status");
}
