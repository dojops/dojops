import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { SYSTEM_TOOLS, findSystemTool, isToolSupportedOnCurrentPlatform } from "@dojops/core";
import { discoverPlugins, validateManifest } from "@dojops/tool-registry";
import * as yaml from "js-yaml";
import { CommandHandler } from "../types";
import { ExitCode } from "../exit-codes";
import {
  loadToolRegistry,
  installSystemTool,
  removeSystemTool,
  cleanAllTools,
  verifyTool,
} from "../tool-sandbox";
import { resolveBinary } from "../preflight";
import { findProjectRoot } from "../state";

export const toolsListCommand: CommandHandler = async (_args, ctx) => {
  const registry = loadToolRegistry();

  if (ctx.globalOpts.output === "json") {
    const data = SYSTEM_TOOLS.map((tool) => {
      const installed = registry.tools.find((t) => t.name === tool.name);
      const supported = isToolSupportedOnCurrentPlatform(tool);
      const systemBinary = resolveBinary(tool.binaryName);

      let status: string;
      if (installed) {
        status = "installed";
      } else if (systemBinary) {
        status = "system";
      } else if (!supported) {
        status = "unsupported";
      } else {
        status = "available";
      }

      return {
        name: tool.name,
        description: tool.description,
        status,
        version: installed?.version ?? tool.latestVersion,
        binaryPath: installed?.binaryPath ?? systemBinary ?? null,
        installedAt: installed?.installedAt ?? null,
      };
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = SYSTEM_TOOLS.map((tool) => {
    const installed = registry.tools.find((t) => t.name === tool.name);
    const supported = isToolSupportedOnCurrentPlatform(tool);
    const systemBinary = resolveBinary(tool.binaryName);

    let statusLabel: string;
    if (installed) {
      statusLabel = pc.green("installed") + pc.dim(` (v${installed.version})`);
    } else if (systemBinary) {
      statusLabel = pc.blue("system") + pc.dim(` (${systemBinary})`);
    } else if (!supported) {
      statusLabel = pc.dim("unsupported");
    } else {
      statusLabel = pc.yellow("available");
    }

    const cols = Math.min(process.stdout.columns || 80, 100);
    const descMax = Math.max(10, cols - 50);
    const desc =
      tool.description.length > descMax
        ? tool.description.slice(0, descMax - 1) + "…"
        : tool.description;
    return `  ${pc.cyan(tool.name.padEnd(14))} ${statusLabel}  ${pc.dim(desc)}`;
  });

  p.note(lines.join("\n"), "System Tools");
};

export const toolsLoadCommand: CommandHandler = async () => {
  const s = p.spinner();
  s.start("Scanning for system tools...");

  const registry = loadToolRegistry();

  // Touch each tool to populate PATH cache
  for (const tool of SYSTEM_TOOLS) {
    const alreadyInstalled = registry.tools.find((t) => t.name === tool.name);
    if (!alreadyInstalled) {
      resolveBinary(tool.binaryName);
    }
  }

  s.stop("Scan complete.");

  const installed = registry.tools.length;
  const system = SYSTEM_TOOLS.filter(
    (t) => !registry.tools.find((r) => r.name === t.name) && resolveBinary(t.binaryName),
  ).length;
  const missing = SYSTEM_TOOLS.length - installed - system;

  const lines = [
    `${pc.bold("Sandbox tools:")}  ${installed}`,
    `${pc.bold("System tools:")}   ${system}`,
    `${pc.bold("Not found:")}      ${missing}`,
  ];

  p.note(lines.join("\n"), "Tool Scan Results");

  if (missing > 0) {
    const missingNames = SYSTEM_TOOLS.filter(
      (t) => !registry.tools.find((r) => r.name === t.name) && !resolveBinary(t.binaryName),
    ).map((t) => t.name);
    p.log.info(`Missing: ${pc.dim(missingNames.join(", "))}`);
    p.log.info(`Install with: ${pc.cyan("dojops tools install <name>")}`);
  }
};

export const toolsInstallCommand: CommandHandler = async (args, ctx) => {
  const toolName = args[0];

  if (!toolName) {
    // Interactive selection
    const available = SYSTEM_TOOLS.filter(
      (t) =>
        isToolSupportedOnCurrentPlatform(t) &&
        !loadToolRegistry().tools.find((r) => r.name === t.name),
    );

    if (available.length === 0) {
      p.log.info("All supported tools are already installed.");
      return;
    }

    if (ctx.globalOpts.nonInteractive) {
      p.log.error("Tool name required in non-interactive mode.");
      p.log.info(`  ${pc.dim("$")} dojops tools install <name>`);
      process.exit(ExitCode.VALIDATION_ERROR);
    }

    const selected = await p.multiselect({
      message: "Select tools to install:",
      options: available.map((t) => ({
        value: t.name,
        label: t.name,
        hint: t.description,
      })),
      required: false,
    });

    if (p.isCancel(selected) || selected.length === 0) {
      return;
    }

    for (const name of selected) {
      await doInstall(name);
    }
    return;
  }

  await doInstall(toolName);
};

async function doInstall(name: string): Promise<void> {
  const tool = findSystemTool(name);
  if (!tool) {
    p.log.error(`Unknown tool: ${name}`);
    p.log.info(`Available tools: ${SYSTEM_TOOLS.map((t) => t.name).join(", ")}`);
    return;
  }

  if (!isToolSupportedOnCurrentPlatform(tool)) {
    p.log.error(`${tool.name} is not supported on this platform.`);
    return;
  }

  const s = p.spinner();
  s.start(`Installing ${tool.name}...`);

  try {
    const installed = await installSystemTool(tool);
    s.stop(`${pc.green("\u2713")} ${tool.name} v${installed.version} installed.`);

    // Verify
    const versionOutput = verifyTool(tool);
    if (versionOutput) {
      p.log.info(pc.dim(versionOutput));
    }
  } catch (err) {
    s.stop(`${pc.red("\u2717")} ${tool.name} installation failed.`);
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(msg);
  }
}

export const toolsRemoveCommand: CommandHandler = async (args) => {
  const name = args[0];
  if (!name) {
    p.log.error("Tool name required.");
    p.log.info(`  ${pc.dim("$")} dojops tools remove <name>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const removed = removeSystemTool(name);
  if (removed) {
    p.log.success(`${name} removed from sandbox.`);
  } else {
    p.log.warn(`${name} is not installed in the sandbox.`);
  }
};

export const toolsCleanCommand: CommandHandler = async (args, ctx) => {
  const registry = loadToolRegistry();
  if (registry.tools.length === 0) {
    p.log.info("No tools installed in sandbox.");
    return;
  }

  const hasYes = args.includes("--yes");

  if (!hasYes && !ctx.globalOpts.nonInteractive) {
    const confirm = await p.confirm({
      message: `Remove ${registry.tools.length} tool(s) from sandbox?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      return;
    }
  }

  const result = cleanAllTools();
  if (result.removed.length > 0) {
    p.log.success(`Removed: ${result.removed.join(", ")}`);
  }
};

// --- Plugin subcommands ---

export const toolsPluginsListCommand: CommandHandler = async (_args, ctx) => {
  const projectRoot = findProjectRoot() ?? undefined;
  const plugins = discoverPlugins(projectRoot);

  if (plugins.length === 0) {
    p.log.info("No plugins discovered.");
    p.log.info(pc.dim("Place plugins in ~/.dojops/plugins/<name>/ or .dojops/plugins/<name>/"));
    return;
  }

  if (ctx.globalOpts.output === "json") {
    const data = plugins.map((pl) => ({
      name: pl.manifest.name,
      version: pl.manifest.version,
      description: pl.manifest.description,
      location: pl.source.location,
      path: pl.pluginDir,
      tags: pl.manifest.tags ?? [],
      hash: pl.source.pluginHash,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = plugins.map((pl) => {
    const loc = pl.source.location === "project" ? pc.green("project") : pc.blue("global");
    return `  ${pc.cyan(pl.manifest.name.padEnd(20))} ${pc.dim(`v${pl.manifest.version}`).padEnd(20)} ${loc.padEnd(20)} ${pc.dim(pl.manifest.description)}`;
  });

  p.note(lines.join("\n"), `Plugins (${plugins.length})`);
};

export const toolsPluginsValidateCommand: CommandHandler = async (args) => {
  const pluginPath = args[0];
  if (!pluginPath) {
    p.log.error("Plugin path required.");
    p.log.info(`  ${pc.dim("$")} dojops tools plugins validate <path>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const manifestPath = path.resolve(pluginPath, "plugin.yaml");
  if (!fs.existsSync(manifestPath)) {
    p.log.error(`No plugin.yaml found at ${manifestPath}`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    const data = yaml.load(content);
    const result = validateManifest(data);

    if (result.valid) {
      p.log.success(
        `Plugin manifest is valid: ${result.manifest!.name} v${result.manifest!.version}`,
      );

      // Check input schema file exists
      const inputSchemaPath = path.resolve(pluginPath, result.manifest!.inputSchema);
      if (!fs.existsSync(inputSchemaPath)) {
        p.log.warn(`Input schema file not found: ${inputSchemaPath}`);
      } else {
        p.log.success("Input schema file exists.");
      }
    } else {
      p.log.error(`Invalid plugin manifest: ${result.error}`);
      process.exit(ExitCode.VALIDATION_ERROR);
    }
  } catch (err) {
    p.log.error(`Failed to parse plugin.yaml: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }
};

export const toolsPluginsInitCommand: CommandHandler = async (args) => {
  const pluginName = args[0];
  if (!pluginName) {
    p.log.error("Plugin name required.");
    p.log.info(`  ${pc.dim("$")} dojops tools plugins init <name>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  // Validate name format
  if (!/^[a-z0-9-]+$/.test(pluginName)) {
    p.log.error("Plugin name must be lowercase alphanumeric with hyphens.");
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const pluginDir = path.resolve(".dojops", "plugins", pluginName);
  if (fs.existsSync(pluginDir)) {
    p.log.error(`Plugin directory already exists: ${pluginDir}`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  fs.mkdirSync(pluginDir, { recursive: true });

  const manifest = {
    spec: 1,
    name: pluginName,
    version: "0.1.0",
    type: "tool",
    description: `${pluginName} configuration generator`,
    inputSchema: "input.schema.json",
    tags: [],
    generator: {
      strategy: "llm",
      systemPrompt: `You are a ${pluginName} configuration expert. Generate valid configuration based on the user's requirements. Return a JSON object with the configuration content.`,
      updateMode: true,
    },
    files: [
      {
        path: `{outputPath}/${pluginName}.yaml`,
        serializer: "yaml",
      },
    ],
    detector: {
      path: `{outputPath}/${pluginName}.yaml`,
    },
  };

  const inputSchema = {
    type: "object",
    properties: {
      outputPath: {
        type: "string",
        description: "Directory to write the configuration file",
      },
      description: {
        type: "string",
        description: "What the configuration should do",
      },
    },
    required: ["outputPath", "description"],
  };

  fs.writeFileSync(
    path.join(pluginDir, "plugin.yaml"),
    yaml.dump(manifest, { lineWidth: 120, noRefs: true }),
    "utf-8",
  );

  fs.writeFileSync(
    path.join(pluginDir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2) + "\n",
    "utf-8",
  );

  p.log.success(`Plugin scaffolded at ${pc.underline(pluginDir)}`);
  p.log.info(
    `  ${pc.dim("Edit")} plugin.yaml ${pc.dim("and")} input.schema.json ${pc.dim("to customize.")}`,
  );
};

/**
 * Dispatcher for `dojops tools plugins <sub>`.
 * Registered as `tools plugins` subcommand; dispatches internally to list/validate/init.
 */
export const toolsPluginsCommand: CommandHandler = async (args, ctx) => {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return toolsPluginsListCommand(rest, ctx);
    case "validate":
      return toolsPluginsValidateCommand(rest, ctx);
    case "init":
      return toolsPluginsInitCommand(rest, ctx);
    default:
      // Default to list when no subcommand
      if (!sub) {
        return toolsPluginsListCommand(rest, ctx);
      }
      p.log.error(`Unknown plugins subcommand: ${sub}`);
      p.log.info(`Available: list, validate, init`);
      process.exit(ExitCode.VALIDATION_ERROR);
  }
};
