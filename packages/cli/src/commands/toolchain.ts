import pc from "picocolors";
import * as p from "@clack/prompts";
import { SYSTEM_TOOLS, findSystemTool, isToolSupportedOnCurrentPlatform } from "@dojops/core";
import { CommandHandler } from "../types";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import {
  loadToolchainRegistry,
  installSystemTool,
  removeSystemTool,
  cleanAllToolchain,
  verifyTool,
} from "../toolchain-sandbox";
import { resolveBinary } from "../preflight";

interface ToolStatus {
  installed: ReturnType<typeof loadToolchainRegistry>["tools"][number] | undefined;
  systemBinary: string | undefined;
  supported: boolean;
}

function getToolStatus(
  tool: (typeof SYSTEM_TOOLS)[number],
  registry: ReturnType<typeof loadToolchainRegistry>,
): ToolStatus {
  return {
    installed: registry.tools.find((t) => t.name === tool.name),
    systemBinary: resolveBinary(tool.binaryName),
    supported: isToolSupportedOnCurrentPlatform(tool),
  };
}

function getStatusString(s: ToolStatus): string {
  if (s.installed) return "installed";
  if (s.systemBinary) return "system";
  if (s.supported) return "available";
  return "unsupported";
}

export const toolchainListCommand: CommandHandler = async (_args, ctx) => {
  const registry = loadToolchainRegistry();

  if (ctx.globalOpts.output === "json") {
    const data = SYSTEM_TOOLS.map((tool) => {
      const s = getToolStatus(tool, registry);
      return {
        name: tool.name,
        description: tool.description,
        status: getStatusString(s),
        version: s.installed?.version ?? tool.latestVersion,
        binaryPath: s.installed?.binaryPath ?? s.systemBinary ?? null,
        installedAt: s.installed?.installedAt ?? null,
      };
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = SYSTEM_TOOLS.map((tool) => {
    const s = getToolStatus(tool, registry);

    let statusLabel: string;
    if (s.installed) {
      statusLabel = pc.green("installed") + pc.dim(` (v${s.installed.version})`);
    } else if (s.systemBinary) {
      statusLabel = pc.blue("system") + pc.dim(` (${s.systemBinary})`);
    } else if (s.supported) {
      statusLabel = pc.yellow("available");
    } else {
      statusLabel = pc.dim("unsupported");
    }

    const cols = Math.min(process.stdout.columns || 80, 100);
    const descMax = Math.max(10, cols - 50);
    const desc =
      tool.description.length > descMax
        ? tool.description.slice(0, descMax - 1) + "…"
        : tool.description;
    return `  ${pc.cyan(tool.name.padEnd(14))} ${statusLabel}  ${pc.dim(desc)}`;
  });

  p.note(lines.join("\n"), "Toolchain");
};

export const toolchainLoadCommand: CommandHandler = async () => {
  const isStructured = !process.stdout.isTTY;
  const s = p.spinner();
  if (!isStructured) s.start("Scanning for system tools...");

  const registry = loadToolchainRegistry();

  // Touch each tool to populate PATH cache
  for (const tool of SYSTEM_TOOLS) {
    const alreadyInstalled = registry.tools.find((t) => t.name === tool.name);
    if (!alreadyInstalled) {
      resolveBinary(tool.binaryName);
    }
  }

  if (!isStructured) s.stop("Scan complete.");

  const installed = registry.tools.length;
  const system = SYSTEM_TOOLS.filter(
    (t) => !registry.tools.some((r) => r.name === t.name) && resolveBinary(t.binaryName),
  ).length;
  const missing = SYSTEM_TOOLS.length - installed - system;

  const lines = [
    `${pc.bold("Toolchain tools:")}  ${installed}`,
    `${pc.bold("System tools:")}     ${system}`,
    `${pc.bold("Not found:")}        ${missing}`,
  ];

  p.note(lines.join("\n"), "Toolchain Scan Results");

  if (missing > 0) {
    const missingNames = SYSTEM_TOOLS.filter(
      (t) => !registry.tools.some((r) => r.name === t.name) && !resolveBinary(t.binaryName),
    ).map((t) => t.name);
    p.log.info(`Missing: ${pc.dim(missingNames.join(", "))}`);
    p.log.info(`Install with: ${pc.cyan("dojops toolchain install <name>")}`);
  }
};

export const toolchainInstallCommand: CommandHandler = async (args, ctx) => {
  const toolName = args[0];

  if (!toolName) {
    // Interactive selection
    const available = SYSTEM_TOOLS.filter(
      (t) =>
        isToolSupportedOnCurrentPlatform(t) &&
        !loadToolchainRegistry().tools.some((r) => r.name === t.name),
    );

    if (available.length === 0) {
      p.log.info("All supported tools are already installed.");
      return;
    }

    if (ctx.globalOpts.nonInteractive) {
      p.log.info(`  ${pc.dim("$")} dojops toolchain install <name>`);
      throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name required in non-interactive mode.");
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

  const isStructured = !process.stdout.isTTY;
  const s = p.spinner();
  if (!isStructured) s.start(`Installing ${tool.name}...`);

  try {
    const installed = await installSystemTool(tool);
    if (!isStructured)
      s.stop(`${pc.green("\u2713")} ${tool.name} v${installed.version} installed.`);

    // Verify
    const versionOutput = verifyTool(tool);
    if (versionOutput) {
      p.log.info(pc.dim(versionOutput));
    }
  } catch (err) {
    if (!isStructured) s.stop(`${pc.red("\u2717")} ${tool.name} installation failed.`);
    const msg = toErrorMessage(err);
    p.log.error(msg);
    throw new CLIError(ExitCode.GENERAL_ERROR, `Failed to install ${tool.name}: ${msg}`);
  }
}

export const toolchainRemoveCommand: CommandHandler = async (args) => {
  const name = args[0];
  if (!name) {
    p.log.info(`  ${pc.dim("$")} dojops toolchain remove <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name required.");
  }

  const removed = removeSystemTool(name);
  if (removed) {
    p.log.success(`${name} removed from toolchain.`);
  } else {
    p.log.warn(`${name} is not installed in the toolchain.`);
  }
};

export const toolchainCleanCommand: CommandHandler = async (args, ctx) => {
  const registry = loadToolchainRegistry();
  if (registry.tools.length === 0) {
    p.log.info("No tools installed in toolchain.");
    return;
  }

  const hasYes = args.includes("--yes");

  if (!hasYes && !ctx.globalOpts.nonInteractive) {
    const confirm = await p.confirm({
      message: `Remove ${registry.tools.length} tool(s) from toolchain?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      return;
    }
  }

  const result = cleanAllToolchain();
  if (result.removed.length > 0) {
    p.log.success(`Removed: ${result.removed.join(", ")}`);
  }
};
