import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { HistoryStore } from "./store";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "./factory";
import type { LLMProvider } from "@dojops/core";
import { FallbackProvider } from "@dojops/core";

function loadServerApiKey(): string | undefined {
  const envKey = process.env.DOJOPS_API_KEY;
  if (envKey) return envKey;
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".dojops", "server.json"), "utf-8"),
    );
    return typeof data.apiKey === "string" ? data.apiKey : undefined;
  } catch {
    return undefined;
  }
}

let provider: LLMProvider = createProvider();

// Wire fallback provider chain if DOJOPS_FALLBACK_PROVIDER is set
const fallbackSpec = process.env.DOJOPS_FALLBACK_PROVIDER;
if (fallbackSpec) {
  const fallbackNames = fallbackSpec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chain: LLMProvider[] = [provider];
  for (const name of fallbackNames) {
    try {
      chain.push(createProvider({ provider: name, model: "" }));
    } catch {
      // Skip misconfigured fallback providers
    }
  }
  if (chain.length > 1) {
    provider = new FallbackProvider(chain);
  }
}

const tools = createTools(provider);
const { router, customAgentNames } = createRouter(provider);
const debugger_ = createDebugger(provider);
const diffAnalyzer = createDiffAnalyzer(provider);

// G-10: Persist history to ~/.dojops/history/
const persistDir = path.join(os.homedir(), ".dojops", "history");
const store = new HistoryStore(1000, persistDir);

const port = Number.parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);
const apiKey = loadServerApiKey();

// G-02: Refuse to start without authentication unless --unsafe-no-auth is passed
if (!apiKey) {
  const unsafeNoAuth = process.argv.includes("--unsafe-no-auth");
  if (!unsafeNoAuth) {
    console.error(
      "ERROR: No API key configured. Refusing to start.\n" +
        "Set DOJOPS_API_KEY env var, run: dojops serve credentials,\n" +
        "or pass --unsafe-no-auth to start without authentication (NOT recommended).",
    );
    process.exit(1);
  }
  console.warn(
    "WARNING: Starting without authentication (--unsafe-no-auth). " +
      "All endpoints except /api/auto are unauthenticated.\n" +
      "Set DOJOPS_API_KEY env var or run: dojops serve credentials",
  );
}

const app = createApp({
  provider,
  tools,
  router,
  debugger: debugger_,
  diffAnalyzer,
  store,
  customAgentNames,
  corsOrigin: `http://localhost:${port}`,
  apiKey,
});

const server = app.listen(port, () => {
  console.log(`\n  🥷 DojOps API server running on http://localhost:${port}`);
  console.log(`  Provider: ${provider.name}`);
  console.log(`  Tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log(`  Dashboard: http://localhost:${port}\n`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown: stop accepting, drain existing connections, force-close after 30s
const shutdown = () => {
  console.log("\nShutting down (30s drain)...");
  server.close(() => {
    console.log("Server stopped.");
    process.exit(0);
  });
  setTimeout(() => {
    console.warn("Force-closing remaining connections...");
    server.closeAllConnections();
    setTimeout(() => process.exit(1), 1_000).unref();
  }, 30_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
