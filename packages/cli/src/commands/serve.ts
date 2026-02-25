import pc from "picocolors";
import * as p from "@clack/prompts";
import { createProvider, createRouter, createDebugger, createDiffAnalyzer } from "@dojops/api";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { resolveToken } from "../config";
import { findProjectRoot } from "../state";

export async function serveCommand(args: string[], ctx: CLIContext): Promise<void> {
  const portArg = extractFlagValue(args, "--port");
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);

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

  const provider = createProvider({ provider: providerName, model, apiKey });
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
    pluginCount: registry.getPlugins().length,
    customAgentNames,
  });

  app.listen(port, () => {
    const noteLines = [
      `${pc.bold("Provider:")}  ${provider.name}`,
      `${pc.bold("Agents:")}    ${pc.cyan(String(router.getAgents().length))} specialist agents loaded`,
      `${pc.bold("Metrics:")}   ${projectRoot ? pc.green("enabled") : pc.yellow("disabled (no project root)")}`,
      `${pc.bold("Dashboard:")} ${pc.underline(`http://localhost:${port}`)}`,
    ];
    p.note(noteLines.join("\n"), "Server Started");
    p.log.success(`DojOps API server running on ${pc.underline(`http://localhost:${port}`)}`);
  });
}
