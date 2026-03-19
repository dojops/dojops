import { z } from "zod";

/** Configuration for a stdio-based MCP server (spawns a subprocess). */
export interface StdioServerConfig {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Env var names to explicitly pass through to the subprocess (bypasses sanitization). */
  allowEnvPassthrough?: string[];
}

/** Configuration for an HTTP-based MCP server (Streamable HTTP). */
export interface HttpServerConfig {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
}

/** Union of all supported MCP server transport configurations. */
export type McpServerConfig = StdioServerConfig | HttpServerConfig;

/** Root MCP configuration — map of server name to config. */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

// ── Zod schemas for validation ──────────────────────────────────────

const StdioServerConfigSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  allowEnvPassthrough: z.array(z.string()).optional(),
});

const HttpServerConfigSchema = z.object({
  transport: z.literal("streamable-http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const McpServerConfigSchema = z.discriminatedUnion("transport", [
  StdioServerConfigSchema,
  HttpServerConfigSchema,
]);

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema),
});
