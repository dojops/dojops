import type { ToolCall, ToolResult, ToolDefinition } from "@dojops/core";
import type { McpClientManager } from "./client-manager";

/** Prefix used for MCP tool names: mcp__<server>__<tool>. */
const MCP_PREFIX = "mcp__";

/**
 * Bridges MCP tools into the ToolExecutor dispatch chain.
 * Parses namespaced tool names and routes calls to the correct MCP server.
 */
export class McpToolDispatcher {
  constructor(private readonly manager: McpClientManager) {}

  /** Whether any MCP servers are connected. */
  isConnected(): boolean {
    return this.manager.getConnectedServers().length > 0;
  }

  /** Check if a tool name uses the mcp__ prefix convention. */
  canHandle(toolName: string): boolean {
    return toolName.startsWith(MCP_PREFIX);
  }

  /** Get all MCP tool definitions (already namespaced). */
  getToolDefinitions(): ToolDefinition[] {
    return this.manager.getToolDefinitions();
  }

  /** Execute an MCP tool call by parsing the namespaced name and routing to the server. */
  async execute(call: ToolCall): Promise<ToolResult> {
    const parsed = parseMcpToolName(call.name);
    if (!parsed) {
      return {
        callId: call.id,
        output: `Invalid MCP tool name format: ${call.name}. Expected mcp__<server>__<tool>`,
        isError: true,
      };
    }

    const { serverName, toolName } = parsed;
    const result = await this.manager.callTool(serverName, toolName, call.arguments);

    return {
      callId: call.id,
      output: result.content,
      isError: result.isError,
    };
  }
}

/** Parse mcp__<server>__<tool> into its components. */
function parseMcpToolName(name: string): { serverName: string; toolName: string } | null {
  if (!name.startsWith(MCP_PREFIX)) return null;

  const rest = name.slice(MCP_PREFIX.length);
  const sepIdx = rest.indexOf("__");
  if (sepIdx < 1) return null;

  const toolName = rest.slice(sepIdx + 2);
  if (!toolName) return null;

  return {
    serverName: rest.slice(0, sepIdx),
    toolName,
  };
}
