import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { McpConfig, McpConfigSchema } from "./types";

/** Default empty config. */
const EMPTY_CONFIG: McpConfig = { mcpServers: {} };

/**
 * Load MCP configuration from project (.dojops/mcp.json) and global (~/.dojops/mcp.json).
 * Project config overrides global by server name.
 */
export function loadMcpConfig(projectDir: string): McpConfig {
  const globalConfig = loadConfigFile(path.join(os.homedir(), ".dojops", "mcp.json"));
  const projectConfig = loadConfigFile(path.join(projectDir, ".dojops", "mcp.json"));

  // Merge: project wins over global by server name
  return {
    mcpServers: {
      ...globalConfig.mcpServers,
      ...projectConfig.mcpServers,
    },
  };
}

/** Save MCP config to the project's .dojops/mcp.json. */
export function saveMcpConfig(projectDir: string, config: McpConfig): void {
  const dir = path.join(projectDir, ".dojops");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/** Read and validate a single MCP config file. Returns empty config on missing/invalid. */
function loadConfigFile(filePath: string): McpConfig {
  if (!fs.existsSync(filePath)) return EMPTY_CONFIG;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const result = McpConfigSchema.safeParse(raw);
    if (result.success) return result.data;
    // Invalid schema — return empty rather than crashing
    return EMPTY_CONFIG;
  } catch {
    return EMPTY_CONFIG;
  }
}
