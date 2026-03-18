import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolDefinition } from "@dojops/core";
import type { McpConfig, McpServerConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PKG_VERSION: string = (require("../package.json") as { version: string }).version;

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

    await client.connect(transport);

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
      // Build env: merge config.env over process.env, filtering undefined values
      const baseEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) baseEnv[k] = v;
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env ? { ...baseEnv, ...config.env } : baseEnv,
      });
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  }
}
