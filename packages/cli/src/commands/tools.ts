import pc from "picocolors";
import * as p from "@clack/prompts";
import { SYSTEM_TOOLS, findSystemTool, isToolSupportedOnCurrentPlatform } from "@odaops/core";
import { CommandHandler } from "../types";
import {
  loadToolRegistry,
  installSystemTool,
  removeSystemTool,
  cleanAllTools,
  verifyTool,
} from "../tool-sandbox";
import { resolveBinary } from "../preflight";

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

    return `  ${pc.cyan(tool.name.padEnd(14))} ${statusLabel.padEnd(50)} ${pc.dim(tool.description)}`;
  });

  p.note(lines.join("\n"), "System Tools");
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
      p.log.info(`  ${pc.dim("$")} oda tools install <name>`);
      process.exit(1);
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
    p.log.info(`  ${pc.dim("$")} oda tools remove <name>`);
    process.exit(1);
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
