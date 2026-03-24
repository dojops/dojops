import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "@dojops/core";
import type { McpConfig, McpServerConfig, StdioServerConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PKG_VERSION: string = (require("../package.json") as { version: string }).version;

/** Maximum time to wait for an MCP server connection (30 seconds). */
const CONNECTION_TIMEOUT_MS = 30_000;

/**
 * Sensitive env var patterns stripped before passing to MCP subprocesses.
 * Prevents credential exfiltration via malicious `.dojops/mcp.json` configs.
 */
const SENSITIVE_KEY_PATTERNS = [
  /_API_KEY$/,
  /_TOKEN$/,
  /_SECRET$/,
  /_PASSWORD$/,
  /_CREDENTIAL$/,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^DEEPSEEK_/,
  /^GEMINI_/,
  /^GITHUB_COPILOT_/,
];

/**
 * Strip sensitive environment variables before passing to MCP subprocesses.
 * Allows explicit passthrough via `allowEnvPassthrough` for vars that MCP
 * servers genuinely need.
 */
export function sanitizeEnvForMcp(
  env: Record<string, string | undefined>,
  allowPassthrough?: string[],
): Record<string, string> {
  const passthroughSet = new Set(allowPassthrough ?? []);
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Allow explicitly whitelisted keys
    if (passthroughSet.has(key)) {
      sanitized[key] = value;
      continue;
    }
    // Strip keys matching sensitive patterns
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (!isSensitive) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  tools: ToolDefinition[];
}

/**
 * Manages MCP server connections and tool discovery.
 * Connect all configured servers at agent start, disconnect on completion.
 */
export class McpClientManager {
  private readonly servers = new Map<string, ConnectedServer>();

  /** Connect to all servers defined in config. Skips servers that fail to connect. */
  async connectAll(config: McpConfig): Promise<void> {
    const entries = Object.entries(config.mcpServers);
    const results = await Promise.allSettled(
      entries.map(([name, serverConfig]) => this.connectServer(name, serverConfig)),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "rejected") {
        // Server failed to connect — skip silently (MCP is optional)
      }
    }
  }

  /** Gracefully disconnect all connected servers. */
  async disconnectAll(): Promise<void> {
    const disconnects = [...this.servers.values()].map(async (server) => {
      try {
        await server.client.close();
      } catch {
        // Best-effort disconnect
      }
    });
    await Promise.allSettled(disconnects);
    this.servers.clear();
  }

  /** Get all tool definitions from all connected servers, namespaced as mcp__<server>__<tool>. */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  /** Call a tool on a specific server. */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    const server = this.servers.get(serverName);
    if (!server) {
      return { content: `MCP server "${serverName}" not connected`, isError: true };
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      const content = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      return { content: content || "(empty response)", isError: result.isError === true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `MCP tool error: ${message}`, isError: true };
    }
  }

  /** Get names of all connected servers. */
  getConnectedServers(): string[] {
    return [...this.servers.keys()];
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const transport = this.createTransport(config);
    const client = new Client({ name: `dojops-${name}`, version: PKG_VERSION });

    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`MCP server "${name}" connection timed out after 30s`)),
          CONNECTION_TIMEOUT_MS,
        ),
      ),
    ]);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: ToolDefinition[] = (toolsResult.tools ?? []).map((t) => ({
      name: `mcp__${name}__${t.name}`,
      description: `[MCP: ${name}] ${t.description ?? t.name}`,
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));

    this.servers.set(name, { name, client, transport, tools });
  }

  private createTransport(
    config: McpServerConfig,
  ): StdioClientTransport | StreamableHTTPClientTransport {
    if (config.transport === "stdio") {
      const stdioConfig = config as StdioServerConfig;

      // H-2: Restrict MCP commands to known-safe binaries
      const ALLOWED_MCP_COMMANDS = new Set([
        "npx",
        "uvx",
        "node",
        "python3",
        "python",
        "deno",
        "bun",
      ]);
      const commandBase = config.command.split("/").pop() ?? config.command;
      if (!ALLOWED_MCP_COMMANDS.has(commandBase)) {
        throw new Error(
          `MCP command "${config.command}" is not in the allowlist. ` +
            `Allowed: ${[...ALLOWED_MCP_COMMANDS].join(", ")}`,
        );
      }

      // Sanitize env: strip sensitive vars from process.env
      const sanitized = sanitizeEnvForMcp(process.env, stdioConfig.allowEnvPassthrough);

      // H-6: Also sanitize config.env overrides and block dangerous env vars
      const BLOCKED_ENV_KEYS = new Set([
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "NODE_OPTIONS",
      ]);
      let mergedEnv = sanitized;
      if (config.env) {
        const sanitizedConfigEnv = sanitizeEnvForMcp(config.env as Record<string, string>);
        // Remove blocked keys from config.env
        for (const key of BLOCKED_ENV_KEYS) {
          delete sanitizedConfigEnv[key];
        }
        mergedEnv = { ...sanitized, ...sanitizedConfigEnv };
      }

      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: mergedEnv,
      });
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  }
}
