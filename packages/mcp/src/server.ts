/**
 * DojOps MCP Server.
 *
 * Exposes DojOps capabilities as MCP tools so external CLI agents
 * (Claude Code, Gemini CLI, GitHub Copilot, OpenClaw) can execute
 * DojOps commands via the Model Context Protocol.
 *
 * Runs in stdio mode: the external agent spawns `dojops serve --mcp`
 * and communicates over stdin/stdout.
 *
 * The server proxies requests to a running `dojops serve` HTTP instance,
 * or can be configured to point to any DojOps API URL.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOL_DEFINITIONS } from "./server-tools";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PKG_VERSION: string = (require("../package.json") as { version: string }).version;

/** Environment-configurable API URL for the DojOps backend. */
const DOJOPS_API_URL = process.env.DOJOPS_API_URL || "http://localhost:3000";
const DOJOPS_API_KEY = process.env.DOJOPS_API_KEY || "";

/**
 * Make an authenticated request to the DojOps API server.
 */
async function apiRequest(
  path: string,
  options: { method?: string; body?: unknown; timeout?: number } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const { method = "GET", body, timeout = 120_000 } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (DOJOPS_API_KEY) {
    headers["X-API-Key"] = DOJOPS_API_KEY;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(`${DOJOPS_API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await resp.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(msg: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

function formatJson(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

/**
 * Create and configure the DojOps MCP server with all tool registrations.
 */
export function createDojOpsMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "dojops",
      version: PKG_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  // ── generate ────────────────────────────────────────────────────
  server.registerTool(
    "dojops_generate",
    {
      description: TOOL_DEFINITIONS.generate.description,
      inputSchema: TOOL_DEFINITIONS.generate.inputSchema,
    },
    async ({ prompt, skill, agent }) => {
      const body: Record<string, unknown> = { prompt };
      if (skill) body.skill = skill;
      if (agent) body.agent = agent;

      const resp = await apiRequest("/api/generate", { method: "POST", body });
      if (!resp.ok)
        return errorResult(`Generate failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── plan ────────────────────────────────────────────────────────
  server.registerTool(
    "dojops_plan",
    {
      description: TOOL_DEFINITIONS.plan.description,
      inputSchema: TOOL_DEFINITIONS.plan.inputSchema,
    },
    async ({ goal, execute, autoApprove }) => {
      const body: Record<string, unknown> = { goal };
      if (execute) body.execute = true;
      if (autoApprove) body.autoApprove = true;

      const resp = await apiRequest("/api/plan", { method: "POST", body });
      if (!resp.ok) return errorResult(`Plan failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── scan ────────────────────────────────────────────────────────
  server.registerTool(
    "dojops_scan",
    {
      description: TOOL_DEFINITIONS.scan.description,
      inputSchema: TOOL_DEFINITIONS.scan.inputSchema,
    },
    async ({ scanners, path }) => {
      const body: Record<string, unknown> = {};
      if (scanners) body.scanners = scanners;
      if (path) body.path = path;

      const resp = await apiRequest("/api/scan", { method: "POST", body, timeout: 180_000 });
      if (!resp.ok) return errorResult(`Scan failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── debug-ci ────────────────────────────────────────────────────
  server.registerTool(
    "dojops_debug_ci",
    {
      description: TOOL_DEFINITIONS["debug-ci"].description,
      inputSchema: TOOL_DEFINITIONS["debug-ci"].inputSchema,
    },
    async ({ log, platform }) => {
      const body: Record<string, unknown> = { log };
      if (platform) body.platform = platform;

      const resp = await apiRequest("/api/debug-ci", { method: "POST", body });
      if (!resp.ok)
        return errorResult(`Debug CI failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── diff-analyze ────────────────────────────────────────────────
  server.registerTool(
    "dojops_diff_analyze",
    {
      description: TOOL_DEFINITIONS["diff-analyze"].description,
      inputSchema: TOOL_DEFINITIONS["diff-analyze"].inputSchema,
    },
    async ({ diff }) => {
      const resp = await apiRequest("/api/diff", { method: "POST", body: { diff } });
      if (!resp.ok)
        return errorResult(`Diff analysis failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── chat ────────────────────────────────────────────────────────
  server.registerTool(
    "dojops_chat",
    {
      description: TOOL_DEFINITIONS.chat.description,
      inputSchema: TOOL_DEFINITIONS.chat.inputSchema,
    },
    async ({ message, sessionId, agent }) => {
      const body: Record<string, unknown> = { message, stream: false };
      if (sessionId) body.sessionId = sessionId;
      if (agent) body.agent = agent;

      const resp = await apiRequest("/api/chat", { method: "POST", body });
      if (!resp.ok) return errorResult(`Chat failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── list-agents ─────────────────────────────────────────────────
  server.registerTool(
    "dojops_list_agents",
    {
      description: TOOL_DEFINITIONS["list-agents"].description,
      inputSchema: TOOL_DEFINITIONS["list-agents"].inputSchema,
    },
    async () => {
      const resp = await apiRequest("/api/agents");
      if (!resp.ok)
        return errorResult(`List agents failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  // ── list-skills ─────────────────────────────────────────────────
  server.registerTool(
    "dojops_list_skills",
    {
      description: TOOL_DEFINITIONS["list-skills"].description,
      inputSchema: TOOL_DEFINITIONS["list-skills"].inputSchema,
    },
    async () => {
      // The skills endpoint is served at /api/generate with a specific query
      // For now, use the agents endpoint which includes skill info
      const resp = await apiRequest("/api/agents");
      if (!resp.ok)
        return errorResult(`List skills failed (${resp.status}): ${formatJson(resp.data)}`);

      const data = resp.data as { agents?: unknown[]; skills?: unknown[] };
      if (data.skills) return textResult(formatJson(data.skills));
      return textResult(formatJson(resp.data));
    },
  );

  // ── repo-scan ───────────────────────────────────────────────────
  server.registerTool(
    "dojops_repo_scan",
    {
      description: TOOL_DEFINITIONS["repo-scan"].description,
      inputSchema: TOOL_DEFINITIONS["repo-scan"].inputSchema,
    },
    async ({ path }) => {
      const body: Record<string, unknown> = {};
      if (path) body.path = path;

      // Repo scan uses the generate endpoint with a scan-oriented prompt
      const resp = await apiRequest("/api/generate", {
        method: "POST",
        body: {
          prompt: `Scan and analyze the repository${path ? ` at ${path}` : ""}: list detected languages, frameworks, CI/CD setup, container configuration, infrastructure files, and security posture.`,
          agent: "devsecops-reviewer",
        },
      });
      if (!resp.ok)
        return errorResult(`Repo scan failed (${resp.status}): ${formatJson(resp.data)}`);
      return textResult(formatJson(resp.data));
    },
  );

  return server;
}

/**
 * Start the DojOps MCP server with stdio transport.
 * Called when `dojops serve --mcp` is invoked.
 */
export async function startMcpServer(): Promise<void> {
  const server = createDojOpsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running — communication happens over stdin/stdout
}
