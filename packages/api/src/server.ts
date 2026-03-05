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

const provider = createProvider();
const tools = createTools(provider);
const { router, customAgentNames } = createRouter(provider);
const debugger_ = createDebugger(provider);
const diffAnalyzer = createDiffAnalyzer(provider);
const store = new HistoryStore();

const port = Number.parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);
const apiKey = loadServerApiKey();

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

if (!apiKey) {
  console.warn(
    "WARNING: No API key configured. All endpoints are unauthenticated.\n" +
      "Set DOJOPS_API_KEY env var or run: dojops serve credentials",
  );
}

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

// Graceful shutdown
const shutdown = () => {
  console.log("\nShutting down...");
  server.close(() => process.exit(0));
  // Force exit after 30s
  setTimeout(() => process.exit(1), 30_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
