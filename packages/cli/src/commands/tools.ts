import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { discoverTools, discoverUserDopsFiles, validateManifest } from "@dojops/tool-registry";
import { parseDopsFile, validateDopsModule } from "@dojops/runtime";
import * as yaml from "js-yaml";
import { CommandHandler } from "../types";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot } from "../state";

/**
 * `dojops tools list` — discovers and lists custom tools (manifest-based + .dops files).
 */
export const toolsListCommand: CommandHandler = async (_args, ctx) => {
  const projectRoot = findProjectRoot() ?? undefined;

  // Discover legacy tools (tool.yaml manifests)
  const legacyTools = discoverTools(projectRoot);

  // Discover .dops files
  const dopsFiles = discoverUserDopsFiles(projectRoot);
  const dopsEntries: Array<{
    name: string;
    version: string;
    description: string;
    location: string;
    filePath: string;
    format: "dops";
  }> = [];

  for (const entry of dopsFiles) {
    try {
      const module = parseDopsFile(entry.filePath);
      dopsEntries.push({
        name: module.frontmatter.meta.name,
        version: module.frontmatter.meta.version,
        description: module.frontmatter.meta.description,
        location: entry.location,
        filePath: entry.filePath,
        format: "dops",
      });
    } catch {
      // Skip invalid .dops files in list
    }
  }

  const totalCount = legacyTools.length + dopsEntries.length;

  if (totalCount === 0) {
    p.log.info("No custom tools discovered.");
    p.log.info(pc.dim("Place tools in ~/.dojops/tools/<name>/ or .dojops/tools/<name>.dops"));
    return;
  }

  if (ctx.globalOpts.output === "json") {
    const data = [
      ...legacyTools.map((t) => ({
        name: t.manifest.name,
        version: t.manifest.version,
        description: t.manifest.description,
        location: t.source.location,
        path: t.toolDir,
        tags: t.manifest.tags ?? [],
        hash: t.source.toolHash,
        format: "legacy" as const,
      })),
      ...dopsEntries.map((d) => ({
        name: d.name,
        version: d.version,
        description: d.description,
        location: d.location,
        path: d.filePath,
        tags: [],
        hash: "",
        format: d.format,
      })),
    ];
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines: string[] = [];

  for (const t of legacyTools) {
    const loc = t.source.location === "project" ? pc.green("project") : pc.blue("global");
    const fmt = pc.dim("legacy");
    lines.push(
      `  ${pc.cyan(t.manifest.name.padEnd(20))} ${pc.dim(`v${t.manifest.version}`).padEnd(20)} ${fmt.padEnd(20)} ${loc.padEnd(20)} ${pc.dim(t.manifest.description)}`,
    );
  }

  for (const d of dopsEntries) {
    const loc = d.location === "project" ? pc.green("project") : pc.blue("global");
    const fmt = pc.yellow("dops");
    lines.push(
      `  ${pc.cyan(d.name.padEnd(20))} ${pc.dim(`v${d.version}`).padEnd(20)} ${fmt.padEnd(20)} ${loc.padEnd(20)} ${pc.dim(d.description)}`,
    );
  }

  p.note(lines.join("\n"), `Tools (${totalCount})`);
};

/**
 * `dojops tools validate <name-or-path>` — validates a tool manifest or .dops file.
 */
export const toolsValidateCommand: CommandHandler = async (args) => {
  const toolPath = args[0];
  if (!toolPath) {
    p.log.info(`  ${pc.dim("$")} dojops tools validate <name-or-path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name or path required.");
  }

  // Check if it's a .dops file (by extension or by discovering it)
  const resolvedPath = path.resolve(toolPath);
  if (toolPath.endsWith(".dops") && fs.existsSync(resolvedPath)) {
    return validateDopsFile(resolvedPath);
  }

  // Check if plain name has a .dops file
  if (!toolPath.includes("/") && !toolPath.includes("\\")) {
    const projectRoot = findProjectRoot();
    const dopsLocations = [
      projectRoot ? path.join(projectRoot, ".dojops", "tools", `${toolPath}.dops`) : null,
      path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? "~",
        ".dojops",
        "tools",
        `${toolPath}.dops`,
      ),
    ].filter(Boolean) as string[];

    for (const loc of dopsLocations) {
      if (fs.existsSync(loc)) {
        return validateDopsFile(loc);
      }
    }
  }

  // Fall back to legacy tool.yaml validation
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
        resolvedDir = projectToolDir;
      }
    }
  } else {
    resolvedDir = path.resolve(toolPath);
  }

  let manifestPath = path.join(resolvedDir, "tool.yaml");
  if (!fs.existsSync(manifestPath)) {
    manifestPath = path.join(resolvedDir, "plugin.yaml");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `No tool.yaml or .dops file found for "${toolPath}"`,
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

function validateDopsFile(filePath: string): void {
  try {
    const module = parseDopsFile(filePath);
    const result = validateDopsModule(module);

    if (result.valid) {
      p.log.success(
        `DOPS module is valid: ${module.frontmatter.meta.name} v${module.frontmatter.meta.version}`,
      );
      p.log.info(pc.dim(`  Format: .dops`));
      p.log.info(pc.dim(`  Files: ${module.frontmatter.files.length}`));
      p.log.info(
        pc.dim(
          `  Sections: Prompt, ${module.sections.updatePrompt ? "Update Prompt, " : ""}Keywords`,
        ),
      );
      if (module.frontmatter.verification?.structural) {
        p.log.info(
          pc.dim(`  Structural rules: ${module.frontmatter.verification.structural.length}`),
        );
      }
      if (module.frontmatter.verification?.binary) {
        p.log.info(pc.dim(`  Binary verifier: ${module.frontmatter.verification.binary.parser}`));
      }
    } else {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Invalid DOPS module:\n  ${(result.errors ?? []).join("\n  ")}`,
      );
    }
  } catch (err) {
    if (err instanceof CLIError) throw err;
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Failed to parse DOPS file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * `dojops tools init <name>` — scaffolds a .dops file in .dojops/tools/
 * Falls back to legacy tool.yaml + input.schema.json with --legacy flag.
 */
export const toolsInitCommand: CommandHandler = async (args, ctx) => {
  let toolName = args[0];
  let description = "";
  let format: "yaml" | "json" | "hcl" | "raw" = "yaml";
  let systemPrompt = "";
  let filePath = "";
  const isNonInteractive = args.includes("--non-interactive") || ctx.globalOpts.nonInteractive;
  const isLegacy = args.includes("--legacy");

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
        { value: "hcl", label: "HCL" },
        { value: "raw", label: "Raw text" },
      ],
    });
    if (p.isCancel(formatInput)) return;
    format = formatInput as "yaml" | "json" | "hcl" | "raw";

    const promptInput = await p.text({
      message: "System prompt for the LLM generator:",
      placeholder: `You are a ${toolName} configuration expert...`,
    });
    if (p.isCancel(promptInput)) return;
    systemPrompt =
      promptInput ||
      `You are a ${toolName} configuration expert. Generate valid configuration based on the user's requirements. Respond with valid JSON only.`;

    const fileInput = await p.text({
      message: "Output file path template:",
      placeholder: `{outputPath}/${toolName}.${format === "raw" ? "conf" : format}`,
    });
    if (p.isCancel(fileInput)) return;
    filePath = fileInput || `{outputPath}/${toolName}.${format === "raw" ? "conf" : format}`;
  }

  if (!toolName) {
    p.log.info(`  ${pc.dim("$")} dojops tools init <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Tool name required.");
  }

  if (!/^[a-z0-9-]+$/.test(toolName)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Tool name must be lowercase alphanumeric with hyphens.",
    );
  }

  // Apply defaults for non-interactive mode
  if (!description) description = `${toolName} configuration generator`;
  if (!systemPrompt)
    systemPrompt = `You are a ${toolName} configuration expert. Generate valid configuration based on the user's requirements. Respond with valid JSON only.`;
  if (!filePath) filePath = `{outputPath}/${toolName}.${format === "raw" ? "conf" : format}`;

  if (isLegacy) {
    // Legacy mode: scaffold tool.yaml + input.schema.json
    return scaffoldLegacyTool(toolName, description, format, systemPrompt, filePath);
  }

  // Default: scaffold .dops file
  const toolsDir = path.resolve(".dojops", "tools");
  const dopsPath = path.join(toolsDir, `${toolName}.dops`);

  if (fs.existsSync(dopsPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Tool already exists: ${dopsPath}`);
  }

  fs.mkdirSync(toolsDir, { recursive: true });

  const dopsContent = `---
dops: v1
kind: tool

meta:
  name: ${toolName}
  version: 0.1.0
  description: "${description}"
  tags: []

input:
  fields:
    outputPath:
      type: string
      required: true
      description: "Directory to write the configuration file"
    description:
      type: string
      required: true
      description: "What the configuration should do"

output:
  type: object
  required: [content]
  properties:
    content:
      type: object

files:
  - path: "${filePath}"
    format: ${format}
    source: llm

permissions:
  filesystem: write
  child_process: none
  network: none
---
# ${toolName}

## Prompt

${systemPrompt}

## Constraints

- Respond with valid JSON only, no markdown fences
- Follow best practices for the target format

## Keywords

${toolName}
`;

  fs.writeFileSync(dopsPath, dopsContent, "utf-8");

  p.log.success(`Tool scaffolded at ${pc.underline(dopsPath)}`);
  p.log.info(`  ${pc.dim("Edit the .dops file to customize your tool.")}`);
};

function scaffoldLegacyTool(
  toolName: string,
  description: string,
  format: string,
  systemPrompt: string,
  filePath: string,
): void {
  const toolDir = path.resolve(".dojops", "tools", toolName);
  if (fs.existsSync(toolDir)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Tool directory already exists: ${toolDir}`);
  }

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
    files: [{ path: filePath, serializer: format }],
    detector: { path: filePath },
  };

  const inputSchema = {
    type: "object",
    properties: {
      outputPath: { type: "string", description: "Directory to write the configuration file" },
      description: { type: "string", description: "What the configuration should do" },
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
}

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
