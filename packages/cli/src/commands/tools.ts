import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { z } from "zod";
import { discoverTools, discoverUserDopsFiles, validateManifest } from "@dojops/tool-registry";
import { parseDopsFileAny, validateDopsModuleAny } from "@dojops/runtime";
import { parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { CommandHandler, CLIContext } from "../types";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { extractFlagValue } from "../parser";
import { findProjectRoot } from "../state";

/**
 * Converts a hyphenated tool name to title case (e.g., "redis-config" → "Redis Config").
 */
function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Zod schema for LLM-generated module content ────────────────────

const InitModuleResponseSchema = z.object({
  outputGuidance: z.string().min(1),
  bestPractices: z.array(z.string().min(1)).min(3).max(10),
  context7Libraries: z
    .array(
      z.object({
        name: z.string().min(1),
        query: z.string().min(1),
      }),
    )
    .default([]),
  prompt: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(3),
  scopePatterns: z.array(z.string().min(1)).min(1),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  riskRationale: z.string().min(1),
  detectionPaths: z.array(z.string().min(1)).min(1),
  structuralRules: z
    .array(
      z.object({
        path: z.string(),
        required: z.boolean(),
        message: z.string(),
      }),
    )
    .default([]),
});

type InitModuleResponse = z.infer<typeof InitModuleResponseSchema>;

const DEFAULT_HUB_URL = process.env.DOJOPS_HUB_URL || "https://hub.dojops.ai";

function throwHubError(err: unknown): never {
  throw new CLIError(
    ExitCode.GENERAL_ERROR,
    `Failed to connect to hub at ${DEFAULT_HUB_URL}: ${toErrorMessage(err)}`,
  );
}

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
      const module = parseDopsFileAny(entry.filePath);
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
    if (ctx.globalOpts.output === "json") {
      console.log("[]");
      return;
    }
    p.log.info("No custom modules discovered.");
    p.log.info(pc.dim("Place modules in ~/.dojops/modules/<name>/ or .dojops/modules/<name>.dops"));
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
    const legacyVersion = pc.dim(`v${t.manifest.version}`);
    lines.push(
      `  ${pc.cyan(t.manifest.name.padEnd(20))} ${legacyVersion.padEnd(20)} ${fmt.padEnd(20)} ${loc.padEnd(20)} ${pc.dim(t.manifest.description)}`,
    );
  }

  for (const d of dopsEntries) {
    const loc = d.location === "project" ? pc.green("project") : pc.blue("global");
    const fmt = pc.yellow("dops");
    const dopsVersion = pc.dim(`v${d.version}`);
    lines.push(
      `  ${pc.cyan(d.name.padEnd(20))} ${dopsVersion.padEnd(20)} ${fmt.padEnd(20)} ${loc.padEnd(20)} ${pc.dim(d.description)}`,
    );
  }

  p.note(lines.join("\n"), `Modules (${totalCount})`);
};

/** Returns the home directory for global .dojops lookups. */
function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "~";
}

/** Search standard locations for a .dops file by name. Returns its path if found. */
function findDopsFileByName(toolPath: string): string | null {
  const projectRoot = findProjectRoot();
  const dopsLocations = [
    projectRoot ? path.join(projectRoot, ".dojops", "modules", `${toolPath}.dops`) : null,
    projectRoot ? path.join(projectRoot, ".dojops", "tools", `${toolPath}.dops`) : null,
    path.join(getHomeDir(), ".dojops", "modules", `${toolPath}.dops`),
    path.join(getHomeDir(), ".dojops", "tools", `${toolPath}.dops`),
  ].filter(Boolean) as string[];

  for (const loc of dopsLocations) {
    if (fs.existsSync(loc)) return loc;
  }
  return null;
}

/** Check if a directory contains a tool.yaml or plugin.yaml. */
function hasManifest(dir: string): boolean {
  return fs.existsSync(path.join(dir, "tool.yaml")) || fs.existsSync(path.join(dir, "plugin.yaml"));
}

/** Resolve legacy tool directory by name from standard locations. */
function resolveLegacyToolDir(toolPath: string): string {
  const projectRoot = findProjectRoot();
  const projectToolDir = projectRoot
    ? path.join(projectRoot, ".dojops", "tools", toolPath)
    : path.resolve(".dojops", "tools", toolPath);
  const globalToolDir = path.join(getHomeDir(), ".dojops", "tools", toolPath);

  if (hasManifest(projectToolDir)) return projectToolDir;
  if (hasManifest(globalToolDir)) return globalToolDir;

  const projectPluginDir = projectRoot
    ? path.join(projectRoot, ".dojops", "plugins", toolPath)
    : path.resolve(".dojops", "plugins", toolPath);
  const globalPluginDir = path.join(getHomeDir(), ".dojops", "plugins", toolPath);

  if (hasManifest(projectPluginDir)) return projectPluginDir;
  if (hasManifest(globalPluginDir)) return globalPluginDir;

  return projectToolDir;
}

/** Validate a legacy tool.yaml manifest at the given directory. */
function validateLegacyManifest(resolvedDir: string, toolPath: string): void {
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
        `Module manifest is valid: ${result.manifest!.name} v${result.manifest!.version}`,
      );
      const inputSchemaPath = path.join(resolvedDir, result.manifest!.inputSchema);
      if (fs.existsSync(inputSchemaPath)) {
        p.log.success("Input schema file exists.");
      } else {
        p.log.warn(`Input schema file not found: ${inputSchemaPath}`);
      }
    } else {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid module manifest: ${result.error}`);
    }
  } catch (err) {
    if (err instanceof CLIError) throw err;
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Failed to parse module manifest: ${toErrorMessage(err)}`,
    );
  }
}

/**
 * `dojops tools validate <name-or-path>` — validates a tool manifest or .dops file.
 */
export const toolsValidateCommand: CommandHandler = async (args) => {
  const toolPath = args[0];
  if (!toolPath) {
    p.log.info(`  ${pc.dim("$")} dojops modules validate <name-or-path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Module name or path required.");
  }

  // Check if it's a .dops file (by extension)
  const resolvedPath = path.resolve(toolPath);
  if (toolPath.endsWith(".dops") && fs.existsSync(resolvedPath)) {
    return validateDopsFile(resolvedPath);
  }

  // Check if plain name has a .dops file
  if (!toolPath.includes("/") && !toolPath.includes("\\")) {
    const found = findDopsFileByName(toolPath);
    if (found) return validateDopsFile(found);
  }

  // Fall back to legacy tool.yaml validation
  const isPlainName =
    !toolPath.includes("/") && !toolPath.includes("\\") && !toolPath.includes(".");
  const resolvedDir = isPlainName ? resolveLegacyToolDir(toolPath) : path.resolve(toolPath);

  validateLegacyManifest(resolvedDir, toolPath);
};

function validateDopsFile(filePath: string): void {
  try {
    const module = parseDopsFileAny(filePath);
    const result = validateDopsModuleAny(module);

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
      `Failed to parse DOPS file: ${toErrorMessage(err)}`,
    );
  }
}

/**
 * `dojops tools init <name>` — scaffolds a v2 .dops file in .dojops/modules/
 * Uses AI to generate best practices and prompts when a provider is configured.
 * Falls back to legacy tool.yaml + input.schema.json with --legacy flag.
 */
type FileFormatType = "yaml" | "json" | "hcl" | "raw" | "ini" | "toml";

interface InitWizardResult {
  toolName: string;
  description: string;
  technology: string;
  fileFormat: FileFormatType;
  outputFilePath: string;
  useLLM: boolean;
}

async function runInitWizard(
  ctx: CLIContext,
  isLegacy: boolean,
): Promise<InitWizardResult | undefined> {
  const nameInput = await p.text({
    message: "Module name (lowercase, hyphens allowed):",
    placeholder: "my-tool",
    validate: (val) => {
      if (!val) return "Name is required";
      if (!/^[a-z0-9-]+$/.test(val)) return "Must be lowercase alphanumeric with hyphens";
      return undefined;
    },
  });
  if (p.isCancel(nameInput)) return undefined;
  const toolName = nameInput;

  const descInput = await p.text({
    message: "Short description:",
    placeholder: `${toolName} configuration generator`,
  });
  if (p.isCancel(descInput)) return undefined;
  const description = descInput || `${toolName} configuration generator`;

  const techInput = await p.text({
    message: "What technology? (e.g., Nginx, Redis, PostgreSQL, Caddy)",
    placeholder: titleCase(toolName),
  });
  if (p.isCancel(techInput)) return undefined;
  const technology = techInput || titleCase(toolName);

  const formatInput = await p.select({
    message: "Output file format:",
    options: [
      { value: "yaml", label: "YAML" },
      { value: "json", label: "JSON" },
      { value: "hcl", label: "HCL" },
      { value: "raw", label: "Raw text (conf, ini, etc.)" },
      { value: "ini", label: "INI" },
      { value: "toml", label: "TOML" },
    ],
  });
  if (p.isCancel(formatInput)) return undefined;
  const fileFormat = formatInput as FileFormatType;

  const fileExt = fileFormat === "raw" ? "conf" : fileFormat;
  const filePathInput = await p.text({
    message: "Output file path:",
    placeholder: `${toolName}.${fileExt}`,
  });
  if (p.isCancel(filePathInput)) return undefined;
  const outputFilePath = filePathInput || `${toolName}.${fileExt}`;

  let useLLM = false;
  if (!isLegacy) {
    let providerAvailable = false;
    try {
      ctx.getProvider();
      providerAvailable = true;
    } catch {
      // No provider configured
    }

    if (providerAvailable) {
      const llmInput = await p.confirm({
        message: "Generate module content with AI?",
        initialValue: true,
      });
      if (p.isCancel(llmInput)) return undefined;
      useLLM = llmInput;
    }
  }

  return { toolName, description, technology, fileFormat, outputFilePath, useLLM };
}

export const toolsInitCommand: CommandHandler = async (args, ctx) => {
  let toolName = args.find((a) => !a.startsWith("-"));
  let description = "";
  let technology = "";
  let fileFormat: FileFormatType = "yaml";
  let outputFilePath = "";
  let useLLM = false;
  const isNonInteractive = args.includes("--non-interactive") || ctx.globalOpts.nonInteractive;
  const isLegacy = args.includes("--legacy");

  if (!toolName && !isNonInteractive) {
    const result = await runInitWizard(ctx, isLegacy);
    if (!result) return;
    toolName = result.toolName;
    description = result.description;
    technology = result.technology;
    fileFormat = result.fileFormat;
    outputFilePath = result.outputFilePath;
    useLLM = result.useLLM;
  }

  if (!toolName) {
    p.log.info(`  ${pc.dim("$")} dojops modules init <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Module name required.");
  }

  if (!/^[a-z0-9-]+$/.test(toolName)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Module name must be lowercase alphanumeric with hyphens.",
    );
  }

  if (!description) description = `${toolName} configuration generator`;
  if (!technology) technology = titleCase(toolName);
  const fileExt = fileFormat === "raw" ? "conf" : fileFormat;
  if (!outputFilePath) outputFilePath = `${toolName}.${fileExt}`;

  if (isLegacy) {
    const legacyPrompt = `You are a ${toolName} configuration expert. Generate valid configuration based on the user's requirements. Respond with valid JSON only.`;
    const legacyFilePath = `{outputPath}/${outputFilePath}`;
    return scaffoldLegacyTool(
      toolName,
      description,
      fileFormat === "ini" || fileFormat === "toml" ? "raw" : fileFormat,
      legacyPrompt,
      legacyFilePath,
    );
  }

  const toolsDir = path.resolve(".dojops", "modules");
  const dopsPath = path.join(toolsDir, `${toolName}.dops`);

  if (fs.existsSync(dopsPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Module already exists: ${dopsPath}`);
  }

  fs.mkdirSync(toolsDir, { recursive: true });

  let llmContent: InitModuleResponse | undefined;
  if (useLLM) {
    llmContent = await generateModuleWithLLM(ctx, {
      name: toolName,
      description,
      technology,
      fileFormat,
      outputFilePath,
    });
  }

  const dopsContent = buildV2Template({
    name: toolName,
    description,
    technology,
    fileFormat,
    outputFilePath,
    llm: llmContent,
  });

  fs.writeFileSync(dopsPath, dopsContent, "utf-8");

  p.log.success(`Module scaffolded at ${pc.underline(dopsPath)}`);
  if (llmContent) {
    p.log.info(`  ${pc.dim("AI-generated best practices and prompt included.")}`);
  }
  p.log.info(`  ${pc.dim("Edit the .dops file to customize your module.")}`);
};

// ── LLM-powered module generation ─────────────────────────────────

interface ModuleInitParams {
  name: string;
  description: string;
  technology: string;
  fileFormat: string;
  outputFilePath: string;
}

async function generateModuleWithLLM(
  ctx: CLIContext,
  params: ModuleInitParams,
): Promise<InitModuleResponse | undefined> {
  const spinner = p.spinner();
  spinner.start("Generating module content with AI...");

  try {
    const provider = ctx.getProvider();

    const systemPrompt = `You are a DevOps module designer for the DojOps AI DevOps automation engine.
Generate a module specification for a "${params.technology}" configuration generator
that outputs ${params.fileFormat} files.

Module name: ${params.name}
Description: ${params.description}
Output file: ${params.outputFilePath}

Respond with JSON containing:
- outputGuidance: 2-4 sentences instructing an LLM what to generate. Must tell it to output raw ${params.fileFormat} content directly without JSON wrapping or code fences.
- bestPractices: Array of 5-8 specific, actionable best practices for ${params.technology} configuration. Be specific to the technology, not generic.
- context7Libraries: Array of [{name, query}] for documentation lookups. Use 1-2 entries with the technology name and a specific documentation query.
- prompt: A 2-3 paragraph system prompt for the LLM generator. Must include these exact placeholders: {outputGuidance}, {bestPractices}, {context7Docs}, {projectContext}
- keywords: Array of 5-15 keywords for routing (technology names, config types, related tools)
- scopePatterns: Array of file glob patterns this module is allowed to write (e.g., ["*.conf", "nginx/*.conf"])
- riskLevel: "LOW" for read-only configs, "MEDIUM" for service configs that affect runtime, "HIGH" for security/infra changes
- riskRationale: One sentence explaining the risk classification
- detectionPaths: Array of file paths or glob patterns to detect existing configs for update mode
- structuralRules: Array of validation rules [{path, required: true, message}] for basic output validation (e.g., check required YAML keys exist). Can be empty array for raw formats.`;

    const response = await provider.generate({
      system: systemPrompt,
      prompt: `Generate the module specification JSON for a ${params.technology} configuration generator.`,
      schema: InitModuleResponseSchema,
    });

    const parsed = response.parsed
      ? (InitModuleResponseSchema.parse(response.parsed) as InitModuleResponse)
      : parseAndValidate<InitModuleResponse>(response.content, InitModuleResponseSchema);

    spinner.stop("AI content generated");
    return parsed;
  } catch (err) {
    spinner.stop("AI generation failed — using defaults");
    p.log.warn(pc.dim(`LLM error: ${toErrorMessage(err)}`));
    return undefined;
  }
}

// ── V2 template builder ───────────────────────────────────────────

interface V2TemplateParams {
  name: string;
  description: string;
  technology: string;
  fileFormat: string;
  outputFilePath: string;
  llm?: InitModuleResponse;
}

function buildV2Template(params: V2TemplateParams): string {
  const { name, description, technology, fileFormat, outputFilePath, llm } = params;

  const outputGuidance = llm?.outputGuidance
    ? indent(llm.outputGuidance.trim(), 4)
    : indent(
        `Generate a complete, valid ${technology} configuration file.\nOutput raw file content directly — do NOT wrap in JSON or code fences.`,
        4,
      );

  const bestPractices = llm?.bestPractices
    ? llm.bestPractices.map((bp: string) => `    - "${escapeYaml(bp)}"`).join("\n")
    : [
        `    - "Follow official ${technology} documentation conventions"`,
        `    - "Include comments explaining non-obvious settings"`,
        `    - "Use secure defaults where applicable"`,
      ].join("\n");

  const context7LibraryLines = llm?.context7Libraries?.length
    ? llm.context7Libraries
        .map(
          (lib: { name: string; query: string }) =>
            `    - name: ${lib.name}\n      query: "${escapeYaml(lib.query)}"`,
        )
        .join("\n")
    : `    - name: ${name}\n      query: "${technology} configuration syntax and best practices"`;
  const context7Block = `  context7Libraries:\n${context7LibraryLines}`;

  const detectionPathItems = llm?.detectionPaths
    ? llm.detectionPaths.map((d: string) => `"${d}"`).join(", ")
    : `"${outputFilePath}"`;
  const detectionPaths = `[${detectionPathItems}]`;

  const scopeWriteItems = llm?.scopePatterns
    ? llm.scopePatterns.map((s: string) => `"${s}"`).join(", ")
    : `"${outputFilePath}"`;
  const scopeWrite = `[${scopeWriteItems}]`;

  const riskLevel = llm?.riskLevel ?? "LOW";
  const riskRationale = llm?.riskRationale
    ? escapeYaml(llm.riskRationale)
    : "Generates a single configuration file";

  const structuralBlock = llm?.structuralRules?.length
    ? `\nverification:\n  structural:\n${llm.structuralRules
        .map(
          (r: { path: string; required: boolean; message: string }) =>
            `    - path: "${r.path}"\n      required: ${r.required}\n      message: "${escapeYaml(r.message)}"`,
        )
        .join("\n")}\n`
    : "";

  const prompt = llm?.prompt
    ? llm.prompt.trim()
    : `You are a ${technology} expert. Generate production-ready configuration.\n\n{outputGuidance}\n\nFollow these best practices:\n{bestPractices}\n\n{context7Docs}\n\nProject context: {projectContext}`;

  const keywords = llm?.keywords ? llm.keywords.join(", ") : `${name}, ${technology.toLowerCase()}`;

  return `---
dops: v2
kind: tool

meta:
  name: ${name}
  version: 0.1.0
  description: "${escapeYaml(description)}"
  tags: []

context:
  technology: "${technology}"
  fileFormat: ${fileFormat}
  outputGuidance: |
${outputGuidance}
  bestPractices:
${bestPractices}
${context7Block}

files:
  - path: "${outputFilePath}"
    format: raw

detection:
  paths: ${detectionPaths}
  updateMode: true
${structuralBlock}
permissions:
  filesystem: write
  child_process: none
  network: none

scope:
  write: ${scopeWrite}

risk:
  level: ${riskLevel}
  rationale: "${riskRationale}"

execution:
  mode: generate
  deterministic: false
  idempotent: true

update:
  strategy: replace
  inputSource: file
  injectAs: existingContent
---
# ${name}

## Prompt

${prompt}

## Keywords

${keywords}
`;
}

function escapeYaml(s: string): string {
  return s.replaceAll('"', String.raw`\"`);
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

function scaffoldLegacyTool(
  toolName: string,
  description: string,
  format: string,
  systemPrompt: string,
  filePath: string,
): void {
  const toolDir = path.resolve(".dojops", "modules", toolName);
  if (fs.existsSync(toolDir)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Module directory already exists: ${toolDir}`);
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

  p.log.success(`Module scaffolded at ${pc.underline(toolDir)}`);
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
    p.log.info(`  ${pc.dim("$")} dojops modules load <path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Module directory path required.");
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
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid module manifest: ${result.error}`);
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
    p.log.warn(`Module "${toolName}" already exists at ${destDir}. Overwriting.`);
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.cpSync(resolvedSource, destDir, { recursive: true });

  p.log.success(
    `Module "${toolName}" v${result.manifest!.version} loaded to ${pc.underline(destDir)}`,
  );
};

/**
 * `dojops tools publish [path]` — publishes a .dops file to the DojOps Hub.
 *
 * Usage:
 *   dojops tools publish <file.dops>           # publish a specific file
 *   dojops tools publish <file.dops> --changelog "Initial release"
 *   dojops tools publish <name>                 # find by name in .dojops/tools/
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 *      DOJOPS_HUB_TOKEN (auth token — obtained from hub session)
 */
export const toolsPublishCommand: CommandHandler = async (args) => {
  const target = args[0];
  if (!target) {
    p.log.info(`  ${pc.dim("$")} dojops modules publish <file.dops | name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Path to .dops file or module name required.");
  }

  // Extract --changelog flag
  let changelog: string | undefined;
  const changelogIdx = args.indexOf("--changelog");
  if (changelogIdx !== -1 && args[changelogIdx + 1]) {
    changelog = args[changelogIdx + 1];
  }

  // Resolve the .dops file path
  let dopsPath: string;
  const resolved = path.resolve(target);

  if (target.endsWith(".dops") && fs.existsSync(resolved)) {
    dopsPath = resolved;
  } else if (!target.includes("/") && !target.includes("\\")) {
    // Look up by name in standard locations
    const projectRoot = findProjectRoot();
    const candidates = [
      projectRoot ? path.join(projectRoot, ".dojops", "tools", `${target}.dops`) : null,
      path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? "~",
        ".dojops",
        "tools",
        `${target}.dops`,
      ),
    ].filter(Boolean) as string[];

    const found = candidates.find((c) => fs.existsSync(c));
    if (!found) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `No .dops file found for "${target}". Looked in:\n  ${candidates.join("\n  ")}`,
      );
    }
    dopsPath = found;
  } else {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${resolved}`);
  }

  // Validate locally before publishing
  const spinner = p.spinner();
  spinner.start("Validating .dops file...");

  let module;
  try {
    module = parseDopsFileAny(dopsPath);
    const result = validateDopsModuleAny(module);
    if (!result.valid) {
      spinner.stop("Validation failed");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Invalid DOPS module:\n  ${(result.errors ?? []).join("\n  ")}`,
      );
    }
  } catch (err) {
    spinner.stop("Validation failed");
    if (err instanceof CLIError) throw err;
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Failed to parse: ${toErrorMessage(err)}`);
  }

  const { meta } = module.frontmatter;
  spinner.stop(`Validated: ${pc.cyan(meta.name)} v${meta.version}`);

  // Check for auth token
  const token = process.env.DOJOPS_HUB_TOKEN;
  if (!token) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `No hub auth token. Set DOJOPS_HUB_TOKEN env variable.\n` +
        `  Generate one at ${DEFAULT_HUB_URL}/settings/tokens`,
    );
  }

  // Compute client-side SHA-256 hash (publisher attestation)
  const fileBuffer = fs.readFileSync(dopsPath);
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  p.log.info(`${pc.dim("SHA256:")} ${hash}`);

  // Upload to hub
  spinner.start(`Publishing ${pc.cyan(meta.name)} v${meta.version} to hub...`);

  const boundary = `----DojOpsBoundary${Date.now()}`;
  const fileName = path.basename(dopsPath);

  // Build multipart body manually (no external deps)
  // Include the client-computed sha256 so the hub can verify integrity
  const parts: Buffer[] = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    fileBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\n${hash}`,
    ),
  );
  if (changelog) {
    parts.push(
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="changelog"\r\n\r\n${changelog}`,
      ),
    );
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  try {
    const res = await fetch(`${DEFAULT_HUB_URL}/api/packages`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    const data = await res.json();

    if (!res.ok) {
      spinner.stop("Publish failed");
      throw new CLIError(
        ExitCode.GENERAL_ERROR,
        `Hub error (${res.status}): ${data.error || "Unknown error"}`,
      );
    }

    spinner.stop("Published successfully");

    p.note(
      [
        `${pc.dim("Name:")}    ${pc.cyan(meta.name)}`,
        `${pc.dim("Version:")} v${meta.version}`,
        `${pc.dim("Slug:")}    ${data.slug}`,
        `${pc.dim("SHA256:")}  ${hash}`,
        `${pc.dim("URL:")}     ${DEFAULT_HUB_URL}/packages/${data.slug}`,
      ].join("\n"),
      data.created ? "Published new module" : "Published new version",
    );
  } catch (err) {
    if (err instanceof CLIError) throw err;
    spinner.stop("Publish failed");
    throwHubError(err);
  }
};

/**
 * `dojops tools install <name>` — downloads a .dops tool from the DojOps Hub.
 *
 * Usage:
 *   dojops tools install <name>                  # install latest version
 *   dojops tools install <name> --version 1.0.0  # install specific version
 *   dojops tools install <name> --global         # install to ~/.dojops/tools/
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 */
async function resolveLatestVersion(slug: string, toolName: string): Promise<string> {
  const infoRes = await fetch(`${DEFAULT_HUB_URL}/api/packages/${slug}`);
  if (!infoRes.ok) {
    if (infoRes.status === 404) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Module "${toolName}" not found on hub.`);
    }
    const data = await infoRes.json().catch(() => ({}));
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Hub error: ${(data as { error?: string }).error || infoRes.statusText}`,
    );
  }
  const info = await infoRes.json();
  if (!info.latestVersion) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Module "${toolName}" has no published versions.`,
    );
  }
  return info.latestVersion.semver;
}

async function downloadAndVerify(
  slug: string,
  version: string,
  toolName: string,
): Promise<{ fileBuffer: Buffer; actualHash: string; expectedHash: string | null }> {
  const downloadRes = await fetch(`${DEFAULT_HUB_URL}/api/download/${slug}/${version}`);
  if (!downloadRes.ok) {
    if (downloadRes.status === 404) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Version ${version} not found for "${toolName}".`,
      );
    }
    throw new CLIError(ExitCode.GENERAL_ERROR, `Download failed (${downloadRes.status})`);
  }

  const fileBuffer = Buffer.from(await downloadRes.arrayBuffer());
  const expectedHash = downloadRes.headers.get("x-checksum-sha256");
  const actualHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

  if (expectedHash && actualHash !== expectedHash) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `SHA256 integrity check failed! The downloaded file does not match the publisher's hash.\n` +
        `  Publisher: ${expectedHash}\n` +
        `  Download:  ${actualHash}\n` +
        `This may indicate the file was tampered with. Aborting install.`,
    );
  }
  if (!expectedHash) {
    p.log.warn("No publisher hash available — skipping integrity verification.");
  }

  return { fileBuffer, actualHash, expectedHash };
}

function resolveInstallDir(isGlobal: boolean): string {
  if (isGlobal) {
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".dojops", "tools");
  }
  const projectRoot = findProjectRoot();
  return projectRoot
    ? path.join(projectRoot, ".dojops", "tools")
    : path.resolve(".dojops", "tools");
}

export const toolsInstallCommand: CommandHandler = async (args) => {
  const toolName = args[0];
  if (!toolName) {
    p.log.info(`  ${pc.dim("$")} dojops modules install <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Module name required.");
  }

  let version: string | undefined;
  const versionIdx = args.indexOf("--version");
  if (versionIdx !== -1 && args[versionIdx + 1]) {
    version = args[versionIdx + 1];
  }
  const isGlobal = args.includes("--global");

  const spinner = p.spinner();
  spinner.start(`Fetching ${pc.cyan(toolName)} from hub...`);

  const slug = toolName.toLowerCase().replace(/[^a-z0-9-]/g, "-"); // NOSONAR - character class pattern

  try {
    if (!version) {
      version = await resolveLatestVersion(slug, toolName);
    }

    spinner.message(`Downloading ${pc.cyan(toolName)} v${version}...`);
    const { fileBuffer, actualHash, expectedHash } = await downloadAndVerify(
      slug,
      version,
      toolName,
    );

    spinner.message("Validating...");
    let module;
    try {
      const { parseDopsString } = await import("@dojops/runtime");
      module = parseDopsString(fileBuffer.toString("utf-8"));
    } catch (err) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Downloaded file is not a valid .dops module: ${toErrorMessage(err)}`,
      );
    }

    const destDir = resolveInstallDir(isGlobal);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `${module.frontmatter.meta.name}.dops`);

    if (fs.existsSync(destPath)) {
      try {
        const existing = parseDopsFileAny(destPath);
        p.log.info(
          pc.dim(
            `Upgrading ${existing.frontmatter.meta.name} v${existing.frontmatter.meta.version} -> v${version}`,
          ),
        );
      } catch {
        // Overwrite invalid file
      }
    }

    fs.writeFileSync(destPath, fileBuffer);
    spinner.stop("Installed successfully");

    const loc = isGlobal ? "global" : "project";
    p.note(
      [
        `${pc.dim("Name:")}    ${pc.cyan(module.frontmatter.meta.name)}`,
        `${pc.dim("Version:")} v${version}`,
        `${pc.dim("Path:")}    ${pc.underline(destPath)}`,
        `${pc.dim("Scope:")}   ${loc}`,
        `${pc.dim("SHA256:")}  ${actualHash}`,
        expectedHash ? `${pc.dim("Verify:")}  ${pc.green("OK")} — matches publisher hash` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "Module installed",
    );
  } catch (err) {
    if (err instanceof CLIError) throw err;
    spinner.stop("Failed");
    throwHubError(err);
  }
};

/**
 * `dojops tools search <query>` — searches the DojOps Hub for tools.
 *
 * Usage:
 *   dojops tools search docker           # search for docker-related tools
 *   dojops tools search terraform --limit 5
 *   dojops tools search k8s --output json
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 */
export const toolsSearchCommand: CommandHandler = async (args, ctx) => {
  const query = args.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
    p.log.info(`  ${pc.dim("$")} dojops modules search <query>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Search query required.");
  }

  const limitStr = extractFlagValue(args, "--limit");
  const limit = limitStr ? Math.min(Math.max(Number.parseInt(limitStr, 10) || 20, 1), 50) : 20;
  const isJson = ctx.globalOpts.output === "json";

  const spinner = p.spinner();
  if (!isJson) spinner.start(`Searching hub for "${query}"...`);

  try {
    const url = `${DEFAULT_HUB_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);

    if (!res.ok) {
      if (!isJson) spinner.stop("Search failed");
      if (res.status === 429) {
        throw new CLIError(ExitCode.GENERAL_ERROR, "Rate limited by hub. Try again later.");
      }
      const data = await res.json().catch(() => ({}));
      throw new CLIError(
        ExitCode.GENERAL_ERROR,
        `Hub error (${res.status}): ${(data as { error?: string }).error || res.statusText}`,
      );
    }

    const data = await res.json();
    const packages: Array<{
      name: string;
      slug: string;
      description: string;
      author?: string;
      starCount?: number;
      downloadCount?: number;
      latestVersion?: { semver: string };
      tags?: string[];
    }> = data.packages ?? data.results ?? (Array.isArray(data) ? data : []);

    if (!isJson) spinner.stop(`Found ${packages.length} result(s)`);

    if (packages.length === 0) {
      if (isJson) {
        console.log(JSON.stringify([]));
      } else {
        p.log.info(`No modules found for "${query}".`);
      }
      return;
    }

    if (isJson) {
      console.log(JSON.stringify(packages, null, 2));
      return;
    }

    const lines: string[] = [];
    for (const pkg of packages) {
      const version = pkg.latestVersion?.semver
        ? pc.dim(`v${pkg.latestVersion.semver}`)
        : pc.dim("—");
      const stars = pkg.starCount == null ? "" : `${pc.yellow("★")} ${pkg.starCount}`;
      const downloads = pkg.downloadCount == null ? "" : `${pc.dim("↓")} ${pkg.downloadCount}`;
      const desc = pkg.description ? pc.dim(pkg.description.slice(0, 60)) : "";
      lines.push(
        `  ${pc.cyan(pkg.name.padEnd(25))} ${version.padEnd(20)} ${stars.padEnd(12)} ${downloads.padEnd(12)} ${desc}`,
      );
    }

    p.note(lines.join("\n"), `Search results for "${query}" (${packages.length})`);
    p.log.info(pc.dim(`Install with: dojops modules install <name>`));
  } catch (err) {
    if (err instanceof CLIError) throw err;
    if (!isJson) spinner.stop("Search failed");
    throwHubError(err);
  }
};
