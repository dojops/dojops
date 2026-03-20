import pc from "picocolors";
import * as p from "@clack/prompts";
import { loadMcpConfig, saveMcpConfig, McpClientManager } from "@dojops/mcp";
import type { McpServerConfig } from "@dojops/mcp";
import type { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

export async function mcpCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "add":
      return mcpAdd();
    case "remove":
      return mcpRemove(args.slice(1));
    case "list":
    default:
      return mcpList(ctx);
  }
}

async function mcpList(ctx: CLIContext): Promise<void> {
  const rootDir = findProjectRoot() ?? process.cwd();
  const config = loadMcpConfig(rootDir);
  const entries = Object.entries(config.mcpServers);

  if (entries.length === 0) {
    p.log.info("No MCP servers configured.");
    p.log.info(pc.dim(`Add one with: dojops mcp add`));
    p.log.info(pc.dim(`Or create .dojops/mcp.json manually.`));
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  p.log.info(`${pc.bold("MCP Servers")} (${entries.length})\n`);

  for (const [name, serverConfig] of entries) {
    const transport = serverConfig.transport;
    let detail: string;
    if (transport === "stdio") {
      const argsSuffix = serverConfig.args?.length ? " " + serverConfig.args.join(" ") : "";
      detail = `${serverConfig.command}${argsSuffix}`;
    } else {
      detail = serverConfig.url;
    }

    const transportLabel = pc.dim(`(${transport})`);
    p.log.message(`  ${pc.cyan(name)} ${transportLabel} ${pc.dim(detail)}`);
  }

  // Optionally test connections
  const manager = new McpClientManager();
  try {
    await manager.connectAll(config);
    const connected = manager.getConnectedServers();
    const tools = manager.getToolDefinitions();
    p.log.success(
      `${connected.length}/${entries.length} connected, ${tools.length} tools available`,
    );
  } catch {
    p.log.warn("Could not test server connections.");
  } finally {
    await manager.disconnectAll();
  }
}

async function mcpAdd(): Promise<void> {
  const rootDir = findProjectRoot() ?? process.cwd();
  const config = loadMcpConfig(rootDir);

  const name = await p.text({
    message: "Server name (e.g., filesystem, github, database):",
    validate: (val) => {
      if (!val.trim()) return "Name is required";
      if (!/^[a-z][a-z0-9_-]*$/.test(val))
        return "Use lowercase alphanumeric, hyphens, underscores";
      if (config.mcpServers[val]) return `Server "${val}" already exists`;
      return undefined;
    },
  });
  if (p.isCancel(name)) return;

  const transport = await p.select({
    message: "Transport type:",
    options: [
      { value: "stdio", label: "stdio — Spawn a local process" },
      { value: "streamable-http", label: "streamable-http — Connect to HTTP endpoint" },
    ],
  });
  if (p.isCancel(transport)) return;

  let serverConfig: McpServerConfig;

  if (transport === "stdio") {
    const command = await p.text({
      message: "Command to run (e.g., npx, node, python):",
      validate: (val) => (val.trim() ? undefined : "Command is required"),
    });
    if (p.isCancel(command)) return;

    const argsStr = await p.text({
      message: "Arguments (space-separated, or leave empty):",
      initialValue: "",
    });
    if (p.isCancel(argsStr)) return;

    const args = (argsStr as string).split(/\s+/).filter(Boolean);

    serverConfig = {
      transport: "stdio",
      command: command as string,
      ...(args.length > 0 ? { args } : {}),
    };
  } else {
    const url = await p.text({
      message: "Server URL (e.g., http://localhost:8080/mcp):",
      validate: (val) => {
        try {
          new URL(val);
          return undefined;
        } catch {
          return "Invalid URL";
        }
      },
    });
    if (p.isCancel(url)) return;

    serverConfig = { transport: "streamable-http", url: url as string };
  }

  config.mcpServers[name as string] = serverConfig;
  saveMcpConfig(rootDir, config);
  p.log.success(`Added MCP server "${name}" to .dojops/mcp.json`);
}

async function mcpRemove(args: string[]): Promise<void> {
  const rootDir = findProjectRoot() ?? process.cwd();
  const config = loadMcpConfig(rootDir);

  let name = args[0];
  if (!name) {
    const entries = Object.keys(config.mcpServers);
    if (entries.length === 0) {
      p.log.info("No MCP servers configured.");
      return;
    }
    const selected = await p.select({
      message: "Select server to remove:",
      options: entries.map((n) => ({ value: n, label: n })),
    });
    if (p.isCancel(selected)) return;
    name = selected as string;
  }

  if (!config.mcpServers[name]) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Server "${name}" not found in MCP config.`);
  }

  delete config.mcpServers[name];
  saveMcpConfig(rootDir, config);
  p.log.success(`Removed MCP server "${name}" from .dojops/mcp.json`);
}
