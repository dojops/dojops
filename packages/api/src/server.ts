import "dotenv/config";
import { createApp } from "./app";
import { HistoryStore } from "./store";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "./factory";

const provider = createProvider();
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

const port = parseInt(process.env.DOJOPS_API_PORT ?? "3000", 10);

app.listen(port, () => {
  console.log(`DojOps API server running on http://localhost:${port}`);
  console.log(`Provider: ${provider.name}`);
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log(`Dashboard: http://localhost:${port}`);
});
