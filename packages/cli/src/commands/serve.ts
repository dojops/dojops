import pc from "picocolors";
import * as p from "@clack/prompts";
import { createProvider, createRouter, createDebugger, createDiffAnalyzer } from "@dojops/api";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { extractFlagValue, hasFlag } from "../parser";
import { resolveToken } from "../config";
import { findProjectRoot } from "../state";
import { ExitCode } from "../exit-codes";

export async function serveCommand(args: string[], ctx: CLIContext): Promise<void> {
  const noAuth = hasFlag(args, "--no-auth");
  const portArg = extractFlagValue(args, "--port");
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    p.log.error(`Invalid port: "${portArg ?? process.env.DOJOPS_API_PORT}". Must be 1-65535.`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const { createApp, HistoryStore } = await import("@dojops/api");

  const providerName = ctx.globalOpts.provider ?? ctx.config.defaultProvider ?? "openai";
  const model = ctx.globalOpts.model ?? ctx.config.defaultModel;
  const apiKey = resolveToken(providerName, ctx.config);

  // Populate env vars so createProvider() inside the API also picks them up
  if (providerName) process.env.DOJOPS_PROVIDER = providerName;
  if (model) process.env.DOJOPS_MODEL = model;
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

  // A1: Require API key (or --no-auth) for non-local providers
  const serverApiKey = process.env.DOJOPS_API_KEY;
  if (!serverApiKey && !noAuth) {
    if (providerName === "ollama") {
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

  // Startup validation: warn if no LLM API key configured for cloud providers
  if (providerName !== "ollama" && !apiKey) {
    p.log.warn(
      `No LLM API key found for ${pc.bold(providerName)}. Requests will fail until a key is configured.`,
    );
    p.log.info(`  ${pc.dim("$")} dojops auth login --provider ${providerName} --token <YOUR_KEY>`);
  }

  const provider = createProvider({ provider: providerName, model, apiKey, allowMissing: true });

  // A27: Validate provider connectivity at startup
  if (provider.listModels) {
    try {
      await provider.listModels();
      p.log.success(`Provider "${providerName}" connectivity verified.`);
    } catch (err) {
      p.log.warn(
        `Provider "${providerName}" connectivity check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      p.log.info("The server will start, but requests may fail until the provider is available.");
    }
  }

  const projectRoot = findProjectRoot() ?? undefined;
  const registry = createToolRegistry(provider, projectRoot);
  const tools = registry.getAll();
  const { router, customAgentNames } = createRouter(provider, projectRoot);
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
    corsOrigin: `http://localhost:${port}`,
  });

  const server = app.listen(port, () => {
    const noteLines = [
      `${pc.bold("Provider:")}  ${provider.name}`,
      `${pc.bold("Agents:")}    ${pc.cyan(String(router.getAgents().length))} specialist agents loaded`,
      `${pc.bold("Metrics:")}   ${projectRoot ? pc.green("enabled") : pc.yellow("disabled (no project root)")}`,
      `${pc.bold("Dashboard:")} ${pc.underline(`http://localhost:${port}`)}`,
    ];
    p.note(noteLines.join("\n"), "Server Started");
    p.log.success(`DojOps API server running on ${pc.underline(`http://localhost:${port}`)}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      p.log.error(`Port ${port} is already in use. Try: dojops serve --port=${port + 1}`);
    } else {
      p.log.error(`Server error: ${err.message}`);
    }
    process.exit(ExitCode.GENERAL_ERROR);
  });

  // A23: Graceful shutdown with 30s drain for in-flight LLM requests
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
