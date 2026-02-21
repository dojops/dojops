import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "@odaops/api";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { resolveToken } from "../config";

export async function serveCommand(args: string[], ctx: CLIContext): Promise<void> {
  const portArg = extractFlagValue(args, "--port");
  const port = portArg ? parseInt(portArg, 10) : parseInt(process.env.ODA_API_PORT ?? "3000", 10);

  const { createApp, HistoryStore } = await import("@odaops/api");

  const providerName = ctx.globalOpts.provider ?? ctx.config.defaultProvider ?? "openai";
  const model = ctx.globalOpts.model ?? ctx.config.defaultModel;
  const apiKey = resolveToken(providerName, ctx.config);

  // Populate env vars so createProvider() inside the API also picks them up
  if (providerName) process.env.ODA_PROVIDER = providerName;
  if (model) process.env.ODA_MODEL = model;
  if (apiKey) {
    const envVar = providerName === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[envVar]) process.env[envVar] = apiKey;
  }

  const provider = createProvider({ provider: providerName, model, apiKey });
  const tools = createTools(provider);
  const router = createRouter(provider);
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
  });

  app.listen(port, () => {
    const noteLines = [
      `${pc.bold("Provider:")}  ${provider.name}`,
      `${pc.bold("Tools:")}     ${tools.map((t) => t.name).join(", ")}`,
      `${pc.bold("Dashboard:")} ${pc.underline(`http://localhost:${port}`)}`,
    ];
    p.note(noteLines.join("\n"), "Server Started");
    p.log.success(`ODA API server running on ${pc.underline(`http://localhost:${port}`)}`);
  });
}
