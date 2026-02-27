import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { discoverTools, validateManifest } from "@dojops/tool-registry";
import * as yaml from "js-yaml";
import { CommandHandler } from "../types";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot } from "../state";

/**
 * `dojops tools list` — discovers and lists custom tools (manifest-based).
 */
export const toolsListCommand: CommandHandler = async (_args, ctx) => {
  const projectRoot = findProjectRoot() ?? undefined;
  const tools = discoverTools(projectRoot);

  if (tools.length === 0) {
    p.log.info("No custom tools discovered.");
    p.log.info(pc.dim("Place tools in ~/.dojops/tools/<name>/ or .dojops/tools/<name>/"));
    return;
  }

  if (ctx.globalOpts.output === "json") {
    const data = tools.map((t) => ({
      name: t.manifest.name,
      version: t.manifest.version,
      description: t.manifest.description,
      location: t.source.location,
      path: t.toolDir,
      tags: t.manifest.tags ?? [],
      hash: t.source.toolHash,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines = tools.map((t) => {
    const loc = t.source.location === "project" ? pc.green("project") : pc.blue("global");
    return `  ${pc.cyan(t.manifest.name.padEnd(20))} ${pc.dim(`v${t.manifest.version}`).padEnd(20)} ${loc.padEnd(20)} ${pc.dim(t.manifest.description)}`;
  });

  p.note(lines.join("\n"), `Tools (${tools.length})`);
};

/**
 * `dojops tools validate <name-or-path>` — validates a tool manifest.
 */
export const toolsValidateCommand: CommandHandler = async (args) => {
  const toolPath = args[0];
  if (!toolPath) {
    p.log.info(`  ${pc.dim("$")} dojops tools validate <name-or-path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name or path required.");
  }

  // If it looks like a plain name (no slashes), resolve from .dojops/tools/<name>/
  let resolvedDir: string;
  if (!toolPath.includes("/") && !toolPath.includes("\\") && !toolPath.includes(".")) {
    const projectRoot = findProjectRoot();
    const projectToolDir = projectRoot
      ? path.join(projectRoot, ".dojops", "tools", toolPath)
      : path.resolve(".dojops", "tools", toolPath);
    const globalToolDir = path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? "~",
      ".dojops",
      "tools",
      toolPath,
    );

    // Check both tool.yaml and plugin.yaml (backward compat)
    if (
      fs.existsSync(path.join(projectToolDir, "tool.yaml")) ||
      fs.existsSync(path.join(projectToolDir, "plugin.yaml"))
    ) {
      resolvedDir = projectToolDir;
    } else if (
      fs.existsSync(path.join(globalToolDir, "tool.yaml")) ||
      fs.existsSync(path.join(globalToolDir, "plugin.yaml"))
    ) {
      resolvedDir = globalToolDir;
    } else {
      // Also check legacy plugins/ directories
      const projectPluginDir = projectRoot
        ? path.join(projectRoot, ".dojops", "plugins", toolPath)
        : path.resolve(".dojops", "plugins", toolPath);
      const globalPluginDir = path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? "~",
        ".dojops",
        "plugins",
        toolPath,
      );

      if (
        fs.existsSync(path.join(projectPluginDir, "plugin.yaml")) ||
        fs.existsSync(path.join(projectPluginDir, "tool.yaml"))
      ) {
        resolvedDir = projectPluginDir;
      } else if (
        fs.existsSync(path.join(globalPluginDir, "plugin.yaml")) ||
        fs.existsSync(path.join(globalPluginDir, "tool.yaml"))
      ) {
        resolvedDir = globalPluginDir;
      } else {
        resolvedDir = projectToolDir; // will fail below with a clear message
      }
    }
  } else {
    resolvedDir = path.resolve(toolPath);
  }

  // Check both tool.yaml and plugin.yaml
  let manifestPath = path.join(resolvedDir, "tool.yaml");
  if (!fs.existsSync(manifestPath)) {
    manifestPath = path.join(resolvedDir, "plugin.yaml");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `No tool.yaml found at ${path.join(resolvedDir, "tool.yaml")}`,
    );
  }

  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    const data = yaml.load(content);
    const result = validateManifest(data);

    if (result.valid) {
      p.log.success(
        `Tool manifest is valid: ${result.manifest!.name} v${result.manifest!.version}`,
      );

      // Check input schema file exists
      const inputSchemaPath = path.join(resolvedDir, result.manifest!.inputSchema);
      if (!fs.existsSync(inputSchemaPath)) {
        p.log.warn(`Input schema file not found: ${inputSchemaPath}`);
      } else {
        p.log.success("Input schema file exists.");
      }
    } else {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid tool manifest: ${result.error}`);
    }
  } catch (err) {
    if (err instanceof CLIError) throw err;
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Failed to parse tool manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/**
 * `dojops tools init <name>` — scaffolds tool.yaml + input.schema.json in .dojops/tools/<name>/
 */
export const toolsInitCommand: CommandHandler = async (args, ctx) => {
  let toolName = args[0];
  let description = "";
  let format: "yaml" | "json" | "toml" = "yaml";
  let systemPrompt = "";
  let filePath = "";
  const isNonInteractive = args.includes("--non-interactive") || ctx.globalOpts.nonInteractive;

  // Interactive wizard when no name provided and not in non-interactive mode
  if (!toolName && !isNonInteractive) {
    const nameInput = await p.text({
      message: "Tool name (lowercase, hyphens allowed):",
      placeholder: "my-tool",
      validate: (val) => {
        if (!val) return "Name is required";
        if (!/^[a-z0-9-]+$/.test(val)) return "Must be lowercase alphanumeric with hyphens";
        return undefined;
      },
    });
    if (p.isCancel(nameInput)) return;
    toolName = nameInput;

    const descInput = await p.text({
      message: "Short description:",
      placeholder: `${toolName} configuration generator`,
    });
    if (p.isCancel(descInput)) return;
    description = descInput || `${toolName} configuration generator`;

    const formatInput = await p.select({
      message: "Output format:",
      options: [
        { value: "yaml", label: "YAML" },
        { value: "json", label: "JSON" },
        { value: "toml", label: "TOML" },
      ],
    });
    if (p.isCancel(formatInput)) return;
    format = formatInput as "yaml" | "json" | "toml";

    const promptInput = await p.text({
      message: "System prompt for the LLM generator:",
      placeholder: `You are a ${toolName} configuration expert...`,
    });
    if (p.isCancel(promptInput)) return;
    systemPrompt =
      promptInput ||
      `You are a ${toolName} configuration expert. Generate valid configuration based on the user's requirements. Return a JSON object with the configuration content.`;

    const fileInput = await p.text({
      message: "Output file path template:",
      placeholder: `{outputPath}/${toolName}.${format}`,
    });
    if (p.isCancel(fileInput)) return;
    filePath = fileInput || `{outputPath}/${toolName}.${format}`;
  }

  if (!toolName) {
    p.log.info(`  ${pc.dim("$")} dojops tools init <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name required.");
  }

  // Validate name format
  if (!/^[a-z0-9-]+$/.test(toolName)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Tool name must be lowercase alphanumeric with hyphens.",
    );
  }

  const toolDir = path.resolve(".dojops", "tools", toolName);
  if (fs.existsSync(toolDir)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Tool directory already exists: ${toolDir}`);
  }

  // Apply defaults for non-interactive mode
  if (!description) description = `${toolName} configuration generator`;
  if (!systemPrompt)
    systemPrompt = `You are a ${toolName} configuration expert. Generate valid configuration based on the user's requirements. Return a JSON object with the configuration content.`;
  if (!filePath) filePath = `{outputPath}/${toolName}.${format}`;

  fs.mkdirSync(toolDir, { recursive: true });

  const manifest = {
    spec: 1,
    name: toolName,
    version: "0.1.0",
    type: "tool",
    description,
    inputSchema: "input.schema.json",
    tags: [],
    generator: {
      strategy: "llm",
      systemPrompt,
      updateMode: true,
    },
    files: [
      {
        path: filePath,
        serializer: format,
      },
    ],
    detector: {
      path: filePath,
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
    path.join(toolDir, "tool.yaml"),
    yaml.dump(manifest, { lineWidth: 120, noRefs: true }),
    "utf-8",
  );

  fs.writeFileSync(
    path.join(toolDir, "input.schema.json"),
    JSON.stringify(inputSchema, null, 2) + "\n",
    "utf-8",
  );

  p.log.success(`Tool scaffolded at ${pc.underline(toolDir)}`);
  p.log.info(
    `  ${pc.dim("Edit")} tool.yaml ${pc.dim("and")} input.schema.json ${pc.dim("to customize.")}`,
  );
};

/**
 * `dojops tools load <path>` — loads a tool from a local directory into .dojops/tools/
 */
export const toolsLoadCommand: CommandHandler = async (args) => {
  const sourcePath = args[0];
  if (!sourcePath) {
    p.log.info(`  ${pc.dim("$")} dojops tools load <path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool directory path required.");
  }

  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Directory not found: ${resolvedSource}`);
  }

  // Find manifest file (tool.yaml or plugin.yaml fallback)
  let manifestPath = path.join(resolvedSource, "tool.yaml");
  if (!fs.existsSync(manifestPath)) {
    manifestPath = path.join(resolvedSource, "plugin.yaml");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `No tool.yaml found in ${resolvedSource}`);
  }

  // Validate the manifest
  const content = fs.readFileSync(manifestPath, "utf-8");
  const data = yaml.load(content);
  const result = validateManifest(data);

  if (!result.valid) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid tool manifest: ${result.error}`);
  }

  const toolName = result.manifest!.name;

  // Check input schema exists
  const inputSchemaPath = path.join(resolvedSource, result.manifest!.inputSchema);
  if (!fs.existsSync(inputSchemaPath)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Input schema file not found: ${result.manifest!.inputSchema}`,
    );
  }

  // Copy to .dojops/tools/<name>/
  const destDir = path.resolve(".dojops", "tools", toolName);
  if (fs.existsSync(destDir)) {
    p.log.warn(`Tool "${toolName}" already exists at ${destDir}. Overwriting.`);
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.cpSync(resolvedSource, destDir, { recursive: true });

  p.log.success(
    `Tool "${toolName}" v${result.manifest!.version} loaded to ${pc.underline(destDir)}`,
  );
};
