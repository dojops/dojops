#!/usr/bin/env node
/**
 * Standalone DojOps MCP server entry point.
 *
 * Usage:
 *   npx @dojops/mcp
 *   dojops serve --mcp
 *
 * Environment:
 *   DOJOPS_API_URL   Base URL of running `dojops serve` (default: http://localhost:3000)
 *   DOJOPS_API_KEY   API key for authentication
 */

import { startMcpServer } from "./server";

startMcpServer().catch((err) => {
  process.stderr.write(
    `DojOps MCP server error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
