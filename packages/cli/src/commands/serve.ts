import crypto from "node:crypto";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createProvider, createRouter, createDebugger, createDiffAnalyzer } from "@dojops/api";
import { createToolRegistry } from "@dojops/tool-registry";
import { createAutoInstallHandler } from "../toolchain-sandbox";
import { CLIContext } from "../types";
import { writeFileOwnerOnly } from "../secure-fs";
import { extractFlagValue, hasFlag } from "../parser";
import { resolveProvider, resolveToken, resolveOllamaHost, resolveOllamaTls } from "../config";
import { findProjectRoot } from "../state";
import { ExitCode, toErrorMessage } from "../exit-codes";

const SERVER_JSON_PATH = path.join(os.homedir(), ".dojops", "server.json");

function loadServerApiKey(): string | string[] | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(SERVER_JSON_PATH, "utf-8")) as {
      apiKey?: string;
      apiKeys?: string[];
    };
    // E-3: Support { "apiKeys": ["key1", "key2"] } format for key rotation
    if (Array.isArray(data.apiKeys) && data.apiKeys.length > 0) {
      const validKeys = data.apiKeys.filter((k) => typeof k === "string" && k.length > 0);
      if (validKeys.length > 0) return validKeys.length === 1 ? validKeys[0] : validKeys;
    }
    return typeof data.apiKey === "string" && data.apiKey.length > 0 ? data.apiKey : undefined;
  } catch {
    return undefined;
  }
}

export async function serveCredentialsCommand(): Promise<void> {
  const key = crypto.randomBytes(32).toString("base64url");
  const dir = path.dirname(SERVER_JSON_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileOwnerOnly(SERVER_JSON_PATH, JSON.stringify({ apiKey: key }, null, 2) + "\n");

  p.note(
    [
      `${pc.bold("API Key:")}  ${pc.cyan(key)}`,
      `${pc.bold("Saved to:")} ${pc.dim(SERVER_JSON_PATH)}`,
      "",
      `${pc.dim("The key is auto-loaded by")} ${pc.bold("dojops serve")}${pc.dim(".")}`,
      `${pc.dim("You can also set")} ${pc.bold("DOJOPS_API_KEY")} ${pc.dim("env var instead.")}`,
    ].join("\n"),
    "Credentials Generated",
  );
}

function resolveTlsOptions(args: string[]): { cert: Buffer; key: Buffer } | undefined {
  const tlsCertPath = extractFlagValue(args, "--tls-cert");
  const tlsKeyPath = extractFlagValue(args, "--tls-key");

  if (!tlsCertPath && !tlsKeyPath) return undefined;

  if (!tlsCertPath || !tlsKeyPath) {
    p.log.error("Both --tls-cert and --tls-key must be provided together.");
    process.exit(ExitCode.VALIDATION_ERROR);
  }
  try {
    return {
      cert: fs.readFileSync(tlsCertPath),
      key: fs.readFileSync(tlsKeyPath),
    };
  } catch (err) {
    p.log.error(`Failed to read TLS files: ${toErrorMessage(err)}`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }
}

function populateProviderEnvVars(
  providerName: string,
  model: string | undefined,
  apiKey: string | undefined,
  ollamaHost: string | undefined,
): void {
  if (providerName) process.env.DOJOPS_PROVIDER = providerName;
  if (model) process.env.DOJOPS_MODEL = model;
  if (ollamaHost && !process.env.OLLAMA_HOST) process.env.OLLAMA_HOST = ollamaHost;
  if (apiKey) {
    const envVarMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      gemini: "GEMINI_API_KEY",
    };
    const envVar = envVarMap[providerName] ?? "OPENAI_API_KEY";
    if (!process.env[envVar]) process.env[envVar] = apiKey;
  }
}

function resolveServerApiKey(noAuth: boolean, providerName: string): string | string[] | undefined {
  const serverApiKey = noAuth ? undefined : (process.env.DOJOPS_API_KEY ?? loadServerApiKey());

  if (noAuth) {
    p.log.warn(
      pc.bold(pc.yellow("WARNING:")) +
        " API authentication disabled (--no-auth). Do not expose to untrusted networks.",
    );
  } else if (!serverApiKey) {
    if (providerName === "ollama" || providerName === "github-copilot") {
      p.log.warn(
        `No API key configured (DOJOPS_API_KEY). The API is unprotected. ` +
          `Set DOJOPS_API_KEY or use ${pc.bold("--no-auth")} to suppress this warning.`,
      );
    } else {
      p.log.error(
        `No API key configured (DOJOPS_API_KEY). ` +
          `For cloud providers, authentication is required. ` +
          `Set DOJOPS_API_KEY or use ${pc.bold("--no-auth")} to allow unauthenticated access.`,
      );
      process.exit(ExitCode.VALIDATION_ERROR);
    }
  }

  return serverApiKey;
}

async function loadContext7Providers(): Promise<{
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };
  context7Provider?: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  };
}> {
  if (process.env.DOJOPS_CONTEXT_ENABLED === "false") return {};

  try {
    const { createDocAugmenter, Context7Client } = await import("@dojops/context");
    return {
      docAugmenter: createDocAugmenter({
        apiKey: process.env.DOJOPS_CONTEXT7_API_KEY,
      }),
      context7Provider: new Context7Client({
        apiKey: process.env.DOJOPS_CONTEXT7_API_KEY,
      }),
    };
  } catch {
    return {};
  }
}

export async function serveCommand(args: string[], ctx: CLIContext): Promise<void> {
  if (args[0] === "credentials") {
    return serveCredentialsCommand();
  }

  const noAuth = hasFlag(args, "--no-auth");
  const portArg = extractFlagValue(args, "--port");
  const port = portArg
    ? Number.parseInt(portArg, 10)
    : Number.parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    p.log.error(`Invalid port: "${portArg ?? process.env.DOJOPS_API_PORT}". Must be 1-65535.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const tlsOptions = resolveTlsOptions(args);

  const { createApp, HistoryStore } = await import("@dojops/api");

  const providerFlag = extractFlagValue(args, "--provider") ?? ctx.globalOpts.provider;
  const providerName = resolveProvider(providerFlag, ctx.config);
  const model = ctx.globalOpts.model ?? ctx.config.defaultModel;
  const apiKey = resolveToken(providerName, ctx.config);

  const ollamaHost =
    providerName === "ollama" ? resolveOllamaHost(undefined, ctx.config) : undefined;
  const ollamaTls = providerName === "ollama" ? resolveOllamaTls(undefined, ctx.config) : undefined;

  populateProviderEnvVars(providerName, model, apiKey, ollamaHost);

  const serverApiKey = resolveServerApiKey(noAuth, providerName);

  if (providerName !== "ollama" && providerName !== "github-copilot" && !apiKey) {
    p.log.warn(
      `No LLM API key found for ${pc.bold(providerName)}. Requests will fail until a key is configured.`,
    );
    p.log.info(`  ${pc.dim("$")} dojops auth login --provider ${providerName} --token <YOUR_KEY>`);
  }

  const provider = createProvider({
    provider: providerName,
    model,
    apiKey,
    allowMissing: true,
    ollamaHost,
    ollamaTlsRejectUnauthorized: ollamaTls === false ? false : undefined,
  });

  if (provider.listModels) {
    try {
      await provider.listModels();
      p.log.success(`Provider "${providerName}" connectivity verified.`);
    } catch (err) {
      p.log.warn(`Provider "${providerName}" connectivity check failed: ${toErrorMessage(err)}`);
      p.log.info("The server will start, but requests may fail until the provider is available.");
    }
  }

  const { docAugmenter, context7Provider } = await loadContext7Providers();

  const projectRoot = findProjectRoot() ?? undefined;
  const registry = createToolRegistry(provider, projectRoot, {
    docAugmenter,
    context7Provider,
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
  });
  const tools = registry.getAll();
  const { router, customAgentNames } = createRouter(provider, projectRoot, docAugmenter);
  const debugger_ = createDebugger(provider);
  const diffAnalyzer = createDiffAnalyzer(provider);
  const store = new HistoryStore();

  const app = createApp({
    provider,
    tools,
    router,
    debugger: debugger_,
    diffAnalyzer,
    store,
    rootDir: projectRoot,
    customToolCount: registry.getCustomTools().length,
    customAgentNames,
    corsOrigin: `${tlsOptions ? "https" : "http"}://localhost:${port}`,
    apiKey: serverApiKey ?? undefined,
  });

  const protocol = tlsOptions ? "https" : "http";
  const server = tlsOptions
    ? https.createServer(tlsOptions, app).listen(port, onListening)
    : app.listen(port, onListening);

  function onListening(): void {
    const dashboardUrl = pc.underline(`${protocol}://localhost:${port}`);
    const noteLines = [
      `${pc.bold("Provider:")}  ${provider.name}`,
      `${pc.bold("Agents:")}    ${pc.cyan(String(router.getAgents().length))} specialist agents loaded`,
      `${pc.bold("Metrics:")}   ${projectRoot ? pc.green("enabled") : pc.yellow("disabled (no project root)")}`,
      `${pc.bold("TLS:")}       ${tlsOptions ? pc.green("enabled") : pc.yellow("disabled")}`,
      `${pc.bold("Dashboard:")} ${dashboardUrl}`,
    ];
    p.note(noteLines.join("\n"), "Server Started");
    p.log.success(`DojOps API server running on ${dashboardUrl}`);

    if (!tlsOptions && serverApiKey) {
      p.log.warn(
        `Server is running over ${pc.bold("plain HTTP")} with API key authentication enabled. ` +
          `API keys are transmitted in cleartext. ` +
          `Use ${pc.bold("--tls-cert")} and ${pc.bold("--tls-key")} for HTTPS, ` +
          `or place a TLS-terminating reverse proxy in front.`,
      );
    }
  }

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      p.log.error(`Port ${port} is already in use.`);
      p.log.info(pc.dim(`Try: dojops serve --port=${port + 1}`));
      p.log.info(
        pc.dim(
          `To find the process: lsof -i :${port} (macOS/Linux) or netstat -ano | findstr :${port} (Windows)`,
        ),
      );
    } else {
      p.log.error(`Server error: ${err.message}`);
    }
    process.exit(ExitCode.GENERAL_ERROR);
  });

  const shutdown = () => {
    p.log.info("Shutting down server (30s drain)...");
    server.close(() => {
      p.log.success("Server stopped.");
      process.exit(ExitCode.SUCCESS);
    });
    setTimeout(() => {
      p.log.warn("Force-closing remaining connections...");
      server.closeAllConnections();
      setTimeout(() => process.exit(ExitCode.GENERAL_ERROR), 1000).unref();
    }, 30_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
