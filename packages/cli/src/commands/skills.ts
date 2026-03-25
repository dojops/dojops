import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { z } from "zod";
import { discoverUserDopsFiles } from "@dojops/skill-registry";
import { parseDopsFile, validateDopsSkill } from "@dojops/runtime";
import { parseAndValidate } from "@dojops/core";
import { CommandHandler, CLIContext } from "../types";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { findProjectRoot } from "../state";
import { truncateNoteTitle } from "../formatter";
import {
  isOfflineMode,
  findCachedSkill,
  ensureSkillCache,
  listCachedSkills,
  exportSkillBundle,
  importSkillBundle,
} from "../offline";

type SkillScope = "global" | "project";

/**
 * Prompt the user to select global or project scope for skill operations.
 * Returns the base directory for the selected scope.
 */
async function selectSkillScope(
  nonInteractive: boolean,
  subDir: string = "skills",
): Promise<{ scope: SkillScope; baseDir: string }> {
  const globalDir = path.join(os.homedir(), ".dojops", subDir);
  const projectRoot = findProjectRoot();
  const projectDir = projectRoot
    ? path.join(projectRoot, ".dojops", subDir)
    : path.resolve(".dojops", subDir);

  if (nonInteractive) {
    return { scope: "global", baseDir: globalDir };
  }

  const globalLabel = pc.dim(`(${globalDir})`);
  const projectLabel = pc.dim(`(${projectDir})`);
  const scopeChoice = await p.select({
    message: "Where should the skill be saved?",
    options: [
      {
        value: "global",
        label: `Global ${globalLabel}`,
        hint: "shared across all projects",
      },
      {
        value: "project",
        label: `Project ${projectLabel}`,
        hint: "scoped to this project only",
      },
    ],
    initialValue: "global" as string,
  });

  if (p.isCancel(scopeChoice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return scopeChoice === "project"
    ? { scope: "project", baseDir: projectDir }
    : { scope: "global", baseDir: globalDir };
}

/**
 * Converts a hyphenated skill name to title case (e.g., "redis-config" → "Redis Config").
 */
function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Zod schema for LLM-generated skill content ────────────────────

const InitSkillResponseSchema = z.object({
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

type InitSkillResponse = z.infer<typeof InitSkillResponseSchema>;

export const DEFAULT_HUB_URL = process.env.DOJOPS_HUB_URL || "https://hub.dojops.ai";

function throwHubError(err: unknown): never {
  throw new CLIError(
    ExitCode.GENERAL_ERROR,
    `Failed to connect to hub at ${DEFAULT_HUB_URL}: ${toErrorMessage(err)}`,
  );
}

/**
 * `dojops skills list` — discovers and lists user .dops skills.
 */
export const skillsListCommand: CommandHandler = async (_args, ctx) => {
  const projectRoot = findProjectRoot() ?? undefined;

  // Discover .dops files
  const dopsFiles = discoverUserDopsFiles(projectRoot);
  const dopsEntries: Array<{
    name: string;
    version: string;
    description: string;
    location: string;
    filePath: string;
  }> = [];

  for (const entry of dopsFiles) {
    try {
      const skill = parseDopsFile(entry.filePath);
      dopsEntries.push({
        name: skill.frontmatter.meta.name,
        version: skill.frontmatter.meta.version,
        description: skill.frontmatter.meta.description,
        location: entry.location,
        filePath: entry.filePath,
      });
    } catch {
      // Skip invalid .dops files in list
    }
  }

  if (dopsEntries.length === 0) {
    if (ctx.globalOpts.output === "json") {
      console.log("[]");
      return;
    }
    p.log.info("No custom skills discovered.");
    p.log.info(pc.dim("Place skills in ~/.dojops/skills/ or .dojops/skills/<name>.dops"));
    return;
  }

  if (ctx.globalOpts.output === "json") {
    const data = dopsEntries.map((d) => ({
      name: d.name,
      version: d.version,
      description: d.description,
      location: d.location,
      path: d.filePath,
      tags: [],
      hash: "",
      format: "dops",
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines: string[] = [];

  for (const d of dopsEntries) {
    const loc = d.location === "project" ? pc.green("project") : pc.blue("global");
    const dopsVersion = pc.dim(`v${d.version}`);
    lines.push(
      `  ${pc.cyan(d.name.padEnd(20))} ${dopsVersion.padEnd(20)} ${loc.padEnd(20)} ${pc.dim(d.description)}`,
    );
  }

  p.note(lines.join("\n"), `Skills (${dopsEntries.length})`);
};

/** Returns the home directory for global .dojops lookups. */
function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "~";
}

/** Search standard locations for a .dops file by name. Returns its path if found. */
function findDopsFileByName(toolPath: string): string | null {
  const projectRoot = findProjectRoot();
  const dopsLocations = [
    projectRoot ? path.join(projectRoot, ".dojops", "skills", `${toolPath}.dops`) : null,
    path.join(getHomeDir(), ".dojops", "skills", `${toolPath}.dops`),
  ].filter(Boolean) as string[];

  for (const loc of dopsLocations) {
    if (fs.existsSync(loc)) return loc;
  }
  return null;
}

/**
 * `dojops skills validate <name-or-path>` — validates a .dops skill file.
 */
export const skillsValidateCommand: CommandHandler = async (args) => {
  const toolPath = args[0];
  if (!toolPath) {
    p.log.info(`  ${pc.dim("$")} dojops skills validate <name-or-path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Skill name or path required.");
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

  throw new CLIError(
    ExitCode.VALIDATION_ERROR,
    `No .dops file found for "${toolPath}". Provide a path to a .dops file or a skill name.`,
  );
};

function validateDopsFile(filePath: string): void {
  try {
    const skill = parseDopsFile(filePath);
    const result = validateDopsSkill(skill);

    if (result.valid) {
      p.log.success(
        `DOPS skill is valid: ${skill.frontmatter.meta.name} v${skill.frontmatter.meta.version}`,
      );
      p.log.info(pc.dim(`  Format: .dops`));
      p.log.info(pc.dim(`  Files: ${skill.frontmatter.files.length}`));
      p.log.info(
        pc.dim(
          `  Sections: Prompt, ${skill.sections.updatePrompt ? "Update Prompt, " : ""}Keywords`,
        ),
      );
      if (skill.frontmatter.verification?.structural) {
        p.log.info(
          pc.dim(`  Structural rules: ${skill.frontmatter.verification.structural.length}`),
        );
      }
      if (skill.frontmatter.verification?.binary) {
        p.log.info(pc.dim(`  Binary verifier: ${skill.frontmatter.verification.binary.parser}`));
      }
    } else {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Invalid DOPS skill:\n  ${(result.errors ?? []).join("\n  ")}`,
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
 * `dojops skills init <name>` — scaffolds a v2 .dops skill file in .dojops/skills/
 * Uses AI to generate best practices and prompts when a provider is configured.
 */
type FileFormatType = "yaml" | "json" | "hcl" | "raw" | "ini" | "toml";

interface InitWizardResult {
  skillName: string;
  description: string;
  technology: string;
  fileFormat: FileFormatType;
  outputFilePath: string;
  useLLM: boolean;
}

/** Prompt the user and return undefined if cancelled. */
async function promptText(
  message: string,
  placeholder: string,
  validate?: (val: string) => string | undefined,
): Promise<string | undefined> {
  const input = await p.text({ message, placeholder, validate });
  return p.isCancel(input) ? undefined : input;
}

async function promptUseLLM(ctx: CLIContext, isLegacy: boolean): Promise<boolean> {
  if (isLegacy) return false;
  try {
    ctx.getProvider();
  } catch {
    return false;
  }
  const llmInput = await p.confirm({
    message: "Generate skill content with AI?",
    initialValue: true,
  });
  return p.isCancel(llmInput) ? false : llmInput;
}

async function runInitWizard(
  ctx: CLIContext,
  isLegacy: boolean,
): Promise<InitWizardResult | undefined> {
  const skillName = await promptText(
    "Skill name (lowercase, hyphens allowed):",
    "my-tool",
    (val) => {
      if (!val) return "Name is required";
      if (!/^[a-z0-9-]+$/.test(val)) return "Must be lowercase alphanumeric with hyphens";
      return undefined;
    },
  );
  if (!skillName) return undefined;

  const descInput = await promptText("Short description:", `${skillName} configuration generator`);
  if (descInput === undefined) return undefined;
  const description = descInput || `${skillName} configuration generator`;

  const techInput = await promptText(
    "What technology? (e.g., Nginx, Redis, PostgreSQL, Caddy)",
    titleCase(skillName),
  );
  if (techInput === undefined) return undefined;
  const technology = techInput || titleCase(skillName);

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
  const filePathInput = await promptText("Output file path:", `${skillName}.${fileExt}`);
  if (filePathInput === undefined) return undefined;
  const outputFilePath = filePathInput || `${skillName}.${fileExt}`;

  const useLLM = await promptUseLLM(ctx, isLegacy);

  return { skillName, description, technology, fileFormat, outputFilePath, useLLM };
}

/** Fill in default values for any unset init parameters. */
function applyInitDefaults(params: {
  skillName: string;
  description: string;
  technology: string;
  fileFormat: FileFormatType;
  outputFilePath: string;
}): { description: string; technology: string; outputFilePath: string } {
  const description = params.description || `${params.skillName} configuration generator`;
  const technology = params.technology || titleCase(params.skillName);
  const fileExt = params.fileFormat === "raw" ? "conf" : params.fileFormat;
  const outputFilePath = params.outputFilePath || `${params.skillName}.${fileExt}`;
  return { description, technology, outputFilePath };
}

interface ScaffoldV2SkillOptions {
  ctx: CLIContext;
  skillName: string;
  description: string;
  technology: string;
  fileFormat: FileFormatType;
  outputFilePath: string;
  useLLM: boolean;
  baseDir?: string;
}

/** Scaffold a v2 .dops skill file, optionally using LLM-generated content. */
async function scaffoldV2Skill(opts: ScaffoldV2SkillOptions): Promise<void> {
  const { ctx, skillName, description, technology, fileFormat, outputFilePath, useLLM, baseDir } =
    opts;
  const toolsDir = baseDir ?? path.resolve(".dojops", "skills");
  const dopsPath = path.join(toolsDir, `${skillName}.dops`);

  if (fs.existsSync(dopsPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Skill already exists: ${dopsPath}`);
  }

  fs.mkdirSync(toolsDir, { recursive: true });

  let llmContent: InitSkillResponse | undefined;
  if (useLLM) {
    llmContent = await generateSkillWithLLM(ctx, {
      name: skillName,
      description,
      technology,
      fileFormat,
      outputFilePath,
    });
  }

  const dopsContent = buildV2Template({
    name: skillName,
    description,
    technology,
    fileFormat,
    outputFilePath,
    llm: llmContent,
  });

  fs.writeFileSync(dopsPath, dopsContent, "utf-8");

  p.log.success(`Skill scaffolded at ${pc.underline(dopsPath)}`);
  if (llmContent) {
    p.log.info(`  ${pc.dim("AI-generated best practices and prompt included.")}`);
  }
  p.log.info(`  ${pc.dim("Edit the .dops file to customize your skill.")}`);
}

export const skillsInitCommand: CommandHandler = async (args, ctx) => {
  let skillName = args.find((a) => !a.startsWith("-"));
  let description = "";
  let technology = "";
  let fileFormat: FileFormatType = "yaml";
  let outputFilePath = "";
  let useLLM = false;
  const isNonInteractive = args.includes("--non-interactive") || ctx.globalOpts.nonInteractive;

  if (!skillName && !isNonInteractive) {
    const result = await runInitWizard(ctx, false);
    if (!result) return;
    skillName = result.skillName;
    description = result.description;
    technology = result.technology;
    fileFormat = result.fileFormat;
    outputFilePath = result.outputFilePath;
    useLLM = result.useLLM;
  }

  if (!skillName) {
    p.log.info(`  ${pc.dim("$")} dojops skills init <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Skill name required.");
  }

  if (!/^[a-z0-9-]+$/.test(skillName)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Skill name must be lowercase alphanumeric with hyphens.",
    );
  }

  // Select scope (global or project)
  const { baseDir } = await selectSkillScope(isNonInteractive, "skills");

  const defaults = applyInitDefaults({
    skillName,
    description,
    technology,
    fileFormat,
    outputFilePath,
  });
  description = defaults.description;
  technology = defaults.technology;
  outputFilePath = defaults.outputFilePath;

  return scaffoldV2Skill({
    ctx,
    skillName,
    description,
    technology,
    fileFormat,
    outputFilePath,
    useLLM,
    baseDir,
  });
};

// ── LLM-powered skill generation ─────────────────────────────────

interface SkillInitParams {
  name: string;
  description: string;
  technology: string;
  fileFormat: string;
  outputFilePath: string;
}

async function generateSkillWithLLM(
  ctx: CLIContext,
  params: SkillInitParams,
): Promise<InitSkillResponse | undefined> {
  const spinner = p.spinner();
  spinner.start("Generating skill content with AI...");

  try {
    const provider = ctx.getProvider();

    const systemPrompt = `You are a DevOps skill designer for the DojOps AI DevOps automation engine.
Generate a skill specification for a "${params.technology}" configuration generator
that outputs ${params.fileFormat} files.

Skill name: ${params.name}
Description: ${params.description}
Output file: ${params.outputFilePath}

Respond with JSON containing:
- outputGuidance: 2-4 sentences instructing an LLM what to generate. Must tell it to output raw ${params.fileFormat} content directly without JSON wrapping or code fences.
- bestPractices: Array of 5-8 specific, actionable best practices for ${params.technology} configuration. Be specific to the technology, not generic.
- context7Libraries: Array of [{name, query}] for documentation lookups. Use 1-2 entries with the technology name and a specific documentation query.
- prompt: A 2-3 paragraph system prompt for the LLM generator. Must include these exact placeholders: {outputGuidance}, {bestPractices}, {context7Docs}, {projectContext}
- keywords: Array of 5-15 keywords for routing (technology names, config types, related tools)
- scopePatterns: Array of file glob patterns this skill is allowed to write (e.g., ["*.conf", "nginx/*.conf"])
- riskLevel: "LOW" for read-only configs, "MEDIUM" for service configs that affect runtime, "HIGH" for security/infra changes
- riskRationale: One sentence explaining the risk classification
- detectionPaths: Array of file paths or glob patterns to detect existing configs for update mode
- structuralRules: Array of validation rules [{path, required: true, message}] for basic output validation (e.g., check required YAML keys exist). Can be empty array for raw formats.`;

    const response = await provider.generate({
      system: systemPrompt,
      prompt: `Generate the skill specification JSON for a ${params.technology} configuration generator.`,
      schema: InitSkillResponseSchema,
    });

    const parsed = response.parsed
      ? (InitSkillResponseSchema.parse(response.parsed) as InitSkillResponse)
      : parseAndValidate<InitSkillResponse>(response.content, InitSkillResponseSchema);

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
  llm?: InitSkillResponse;
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

function resolveDopsPath(target: string): string {
  const resolved = path.resolve(target);
  if (target.endsWith(".dops") && fs.existsSync(resolved)) {
    return resolved;
  }
  if (target.includes("/") || target.includes("\\")) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${resolved}`);
  }
  const projectRoot = findProjectRoot();
  const candidates = [
    projectRoot ? path.join(projectRoot, ".dojops", "skills", `${target}.dops`) : null,
    path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? "~",
      ".dojops",
      "skills",
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
  return found;
}

/**
 * `dojops skills publish [path]` — publishes a .dops file to the DojOps Hub.
 *
 * Usage:
 *   dojops skills publish <file.dops>           # publish a specific file
 *   dojops skills publish <file.dops> --changelog "Initial release"
 *   dojops skills publish <name>                 # find by name in .dojops/skills/
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 *      DOJOPS_HUB_TOKEN (auth token — obtained from hub session)
 */
function validateAndParseSkill(dopsPath: string): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skill: any;
  fileBuffer: Buffer;
  hash: string;
} {
  const skill = parseDopsFile(dopsPath);
  const result = validateDopsSkill(skill);
  if (!result.valid) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid DOPS skill:\n  ${(result.errors ?? []).join("\n  ")}`,
    );
  }
  const fileBuffer = fs.readFileSync(dopsPath);
  const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  return { skill, fileBuffer, hash };
}

function requireHubToken(): string {
  const token = process.env.DOJOPS_HUB_TOKEN;
  if (!token) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `No hub auth token. Set DOJOPS_HUB_TOKEN env variable.\n` +
        `  Generate one at ${DEFAULT_HUB_URL}/settings/tokens`,
    );
  }
  return token;
}

function buildMultipartBody(
  fileBuffer: Buffer,
  fileName: string,
  hash: string,
  changelog: string | undefined,
): { body: Buffer; boundary: string } {
  const boundary = `----DojOpsBoundary${Date.now()}`;
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    fileBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\n${hash}`,
    ),
  ];
  if (changelog) {
    parts.push(
      Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="changelog"\r\n\r\n${changelog}`,
      ),
    );
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

async function uploadToHub(
  body: Buffer,
  boundary: string,
  token: string,
): Promise<{ data: Record<string, unknown>; ok: boolean; status: number }> {
  const res = await fetch(`${DEFAULT_HUB_URL}/api/packages`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${token}`,
    },
    body: body as unknown as BodyInit,
  });
  const data = (await res.json()) as Record<string, unknown>;
  return { data, ok: res.ok, status: res.status };
}

export const skillsPublishCommand: CommandHandler = async (args) => {
  const target = args[0];
  if (!target) {
    p.log.info(`  ${pc.dim("$")} dojops skills publish <file.dops | name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Path to .dops file or skill name required.");
  }

  let changelog: string | undefined;
  const changelogIdx = args.indexOf("--changelog");
  if (changelogIdx !== -1 && args[changelogIdx + 1]) {
    changelog = args[changelogIdx + 1];
  }

  const dopsPath = resolveDopsPath(target);
  const spinner = p.spinner();
  spinner.start("Validating .dops file...");

  let skill, fileBuffer: Buffer, hash: string;
  try {
    ({ skill, fileBuffer, hash } = validateAndParseSkill(dopsPath));
  } catch (err) {
    spinner.stop("Validation failed");
    if (err instanceof CLIError) throw err;
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Failed to parse: ${toErrorMessage(err)}`);
  }

  const { meta } = skill.frontmatter;
  spinner.stop(`Validated: ${pc.cyan(meta.name)} v${meta.version}`);

  const token = requireHubToken();
  p.log.info(`${pc.dim("SHA256:")} ${hash}`);
  spinner.start(`Publishing ${pc.cyan(meta.name)} v${meta.version} to hub...`);

  const { body, boundary } = buildMultipartBody(
    fileBuffer,
    path.basename(dopsPath),
    hash,
    changelog,
  );

  try {
    const { data, ok, status } = await uploadToHub(body, boundary, token);
    if (!ok) {
      spinner.stop("Publish failed");
      throw new CLIError(
        ExitCode.GENERAL_ERROR,
        `Hub error (${status}): ${String(data.error) || "Unknown error"}`,
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
      data.created ? "Published new skill" : "Published new version",
    );
  } catch (err) {
    if (err instanceof CLIError) throw err;
    spinner.stop("Publish failed");
    throwHubError(err);
  }
};

/**
 * `dojops skills install <name>` — downloads a .dops skill from the DojOps Hub.
 *
 * Usage:
 *   dojops skills install <name>                  # install latest version
 *   dojops skills install <name> --version 1.0.0  # install specific version
 *   dojops skills install <name> --global         # install to ~/.dojops/skills/
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 */
export async function resolveLatestVersion(slug: string, skillName: string): Promise<string> {
  const infoRes = await fetch(`${DEFAULT_HUB_URL}/api/packages/${slug}`);
  if (!infoRes.ok) {
    if (infoRes.status === 404) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Skill "${skillName}" not found on hub.`);
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
      `Skill "${skillName}" has no published versions.`,
    );
  }
  return info.latestVersion.semver;
}

export async function downloadAndVerify(
  slug: string,
  version: string,
  skillName: string,
  allowUnverified = false,
): Promise<{ fileBuffer: Buffer; actualHash: string; expectedHash: string | null }> {
  const downloadRes = await fetch(`${DEFAULT_HUB_URL}/api/download/${slug}/${version}`);
  if (!downloadRes.ok) {
    if (downloadRes.status === 404) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Version ${version} not found for "${skillName}".`,
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
  if (!expectedHash && !allowUnverified) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Hub did not provide a SHA-256 checksum for this download. Refusing to install.\n` +
        `This may indicate a misconfigured hub or a network-level attack stripping integrity headers.\n` +
        `Use --allow-unverified to bypass this check if you trust the source.`,
    );
  }

  return { fileBuffer, actualHash, expectedHash };
}

export function resolveInstallDir(isGlobal: boolean): string {
  if (isGlobal) {
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".dojops", "skills");
  }
  const projectRoot = findProjectRoot();
  return projectRoot
    ? path.join(projectRoot, ".dojops", "skills")
    : path.resolve(".dojops", "skills");
}

export async function parseDownloadedSkill(
  fileBuffer: Buffer,
): Promise<ReturnType<typeof parseDopsFile>> {
  try {
    const { parseDopsString, validateDopsSkill } = await import("@dojops/runtime");
    const skill = parseDopsString(fileBuffer.toString("utf-8"));
    const result = validateDopsSkill(skill);
    if (!result.valid) {
      throw new Error(`Validation failed: ${(result.errors ?? []).join(", ")}`);
    }
    return skill;
  } catch (err) {
    if (err instanceof CLIError) throw err;
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Downloaded file is not a valid .dops skill: ${toErrorMessage(err)}`,
    );
  }
}

function logUpgradeIfExists(destPath: string, version: string): void {
  if (!fs.existsSync(destPath)) return;
  try {
    const existing = parseDopsFile(destPath);
    p.log.info(
      pc.dim(
        `Upgrading ${existing.frontmatter.meta.name} v${existing.frontmatter.meta.version} -> v${version}`,
      ),
    );
  } catch {
    // Overwrite invalid file
  }
}

export const skillsInstallCommand: CommandHandler = async (args, ctx) => {
  const skillName = args[0];
  if (!skillName) {
    p.log.info(`  ${pc.dim("$")} dojops skills install <name>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Skill name required.");
  }

  let version: string | undefined;
  const versionIdx = args.indexOf("--version");
  if (versionIdx !== -1 && args[versionIdx + 1]) {
    version = args[versionIdx + 1];
  }

  // Support both --global flag (backward compat) and interactive scope prompt
  const hasGlobalFlag = args.includes("--global");
  let destDir: string;
  let loc: string;
  if (hasGlobalFlag || ctx.globalOpts.nonInteractive) {
    destDir = resolveInstallDir(true);
    loc = "global";
  } else {
    const { scope, baseDir } = await selectSkillScope(false);
    destDir = baseDir;
    loc = scope;
  }

  // Offline mode: check cache before reaching out to hub
  if (isOfflineMode()) {
    const projectRoot = findProjectRoot() ?? process.cwd();
    ensureSkillCache(projectRoot);
    const cachedPath = findCachedSkill(projectRoot, skillName);
    if (cachedPath) {
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${skillName}.dops`);
      fs.copyFileSync(cachedPath, destPath);
      p.log.success(`Installed ${pc.cyan(skillName)} from offline cache`);
      p.log.info(`${pc.dim("Path:")} ${pc.underline(destPath)}`);
      return;
    }
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Skill "${skillName}" not found in offline cache. Cache skills first with: dojops skills export <path>`,
    );
  }

  const spinner = p.spinner();
  spinner.start(`Fetching ${pc.cyan(skillName)} from hub...`);

  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-"); // NOSONAR - character class pattern

  try {
    if (!version) {
      version = await resolveLatestVersion(slug, skillName);
    }

    spinner.message(`Downloading ${pc.cyan(skillName)} v${version}...`);
    const allowUnverified = args.includes("--allow-unverified");
    const { fileBuffer, actualHash, expectedHash } = await downloadAndVerify(
      slug,
      version,
      skillName,
      allowUnverified,
    );

    spinner.message("Validating...");
    const skill = await parseDownloadedSkill(fileBuffer);

    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `${skill.frontmatter.meta.name}.dops`);

    logUpgradeIfExists(destPath, version);
    fs.writeFileSync(destPath, fileBuffer);
    // Persist SHA-256 sidecar for load-time re-verification
    fs.writeFileSync(`${destPath}.sha256`, actualHash, "utf-8");
    spinner.stop("Installed successfully");

    p.note(
      [
        `${pc.dim("Name:")}    ${pc.cyan(skill.frontmatter.meta.name)}`,
        `${pc.dim("Version:")} v${version}`,
        `${pc.dim("Path:")}    ${pc.underline(destPath)}`,
        `${pc.dim("Scope:")}   ${loc}`,
        `${pc.dim("SHA256:")}  ${actualHash}`,
        expectedHash ? `${pc.dim("Verify:")}  ${pc.green("OK")} — matches publisher hash` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "Skill installed",
    );
  } catch (err) {
    if (err instanceof CLIError) throw err;
    spinner.stop("Failed");
    throwHubError(err);
  }
};

export interface SearchPackage {
  name: string;
  slug: string;
  description: string;
  author?: string;
  starCount?: number;
  downloadCount?: number;
  latestVersion?: { semver: string };
  tags?: string[];
}

function displaySearchResults(packages: SearchPackage[], query: string, isJson: boolean): void {
  if (packages.length === 0) {
    if (isJson) {
      console.log(JSON.stringify([]));
    } else {
      p.log.info(`No skills found for "${query}".`);
    }
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(packages, null, 2));
    return;
  }

  const lines = packages.map((pkg) => {
    const version = pkg.latestVersion?.semver
      ? pc.dim(`v${pkg.latestVersion.semver}`)
      : pc.dim("—");
    const stars = pkg.starCount == null ? "" : `${pc.yellow("★")} ${pkg.starCount}`;
    const downloads = pkg.downloadCount == null ? "" : `${pc.dim("↓")} ${pkg.downloadCount}`;
    const desc = pkg.description ? pc.dim(pkg.description.slice(0, 60)) : "";
    return `  ${pc.cyan(pkg.name.padEnd(25))} ${version.padEnd(20)} ${stars.padEnd(12)} ${downloads.padEnd(12)} ${desc}`;
  });

  p.note(lines.join("\n"), truncateNoteTitle(`Search results for "${query}" (${packages.length})`));
  p.log.info(pc.dim(`Install with: dojops skills install <name>`));
}

/**
 * `dojops skills search <query>` — searches the DojOps Hub for skills.
 *
 * Usage:
 *   dojops skills search docker           # search for docker-related skills
 *   dojops skills search terraform --limit 5
 *   dojops skills search k8s --output json
 *
 * Env: DOJOPS_HUB_URL (default: https://hub.dojops.ai)
 */
export const skillsSearchCommand: CommandHandler = async (args, ctx) => {
  const query = args.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
    p.log.info(`  ${pc.dim("$")} dojops skills search <query>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Search query required.");
  }

  const limitStr = extractFlagValue(args, "--limit");
  const limit = limitStr ? Math.min(Math.max(Number.parseInt(limitStr, 10) || 20, 1), 50) : 20;
  const isJson = ctx.globalOpts.output === "json";

  // Offline mode: search the local cache instead of the hub
  if (isOfflineMode()) {
    const rootDir = findProjectRoot() ?? process.cwd();
    const cached = listCachedSkills(rootDir);
    const lowerQuery = query.toLowerCase();
    const matched = cached.filter((s) => s.name.toLowerCase().includes(lowerQuery));

    const packages: SearchPackage[] = matched.slice(0, limit).map((s) => ({
      name: s.name,
      slug: s.name,
      description: `Cached skill (${(s.sizeBytes / 1024).toFixed(1)} KB)`,
    }));
    displaySearchResults(packages, query, isJson);
    if (!isJson && matched.length === 0) {
      p.log.info(
        pc.dim("Offline mode: searched local cache only. Run `dojops skills cache` to populate."),
      );
    }
    return;
  }

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
    const packages: SearchPackage[] =
      data.packages ?? data.results ?? (Array.isArray(data) ? data : []);

    if (!isJson) spinner.stop(`Found ${packages.length} result(s)`);

    displaySearchResults(packages, query, isJson);
  } catch (err) {
    if (err instanceof CLIError) throw err;
    if (!isJson) spinner.stop("Search failed");
    throwHubError(err);
  }
};

// ── modules dev ─────────────────────────────────────────────────────

/**
 * `dojops skills dev <path>` — validate a .dops file and optionally watch for changes.
 * Provides real-time feedback during module development.
 */
export const skillsDevCommand: CommandHandler = async (args) => {
  const toolPath = args[0];
  if (!toolPath) {
    p.log.info(`  ${pc.dim("$")} dojops skills dev <path.dops> [--watch]`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Path to .dops file required.");
  }

  const watchMode = hasFlag(args, "--watch");
  const resolvedPath = path.resolve(toolPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${resolvedPath}`);
  }
  if (!resolvedPath.endsWith(".dops")) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Not a .dops file: ${resolvedPath}`);
  }

  runDevValidation(resolvedPath);

  if (watchMode) {
    p.log.info(pc.dim("Watching for changes... (Ctrl+C to stop)"));
    let debounce: ReturnType<typeof setTimeout> | null = null;
    fs.watch(resolvedPath, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log();
        p.log.info(pc.dim(`[${new Date().toLocaleTimeString()}] File changed, re-validating...`));
        runDevValidation(resolvedPath);
      }, 300);
    });
    // Keep process alive
    await new Promise(() => {});
  }
};

function runDevValidation(filePath: string): void {
  try {
    const skill = parseDopsFile(filePath);
    const result = validateDopsSkill(skill);

    if (result.valid) {
      p.log.success(
        `${pc.bold(skill.frontmatter.meta.name)} v${skill.frontmatter.meta.version} — valid`,
      );
      const stats = {
        files: skill.frontmatter.files.length,
        sections: ["Prompt", skill.sections.updatePrompt ? "Update" : null, "Keywords"]
          .filter(Boolean)
          .join(", "),
        risk: skill.frontmatter.risk?.level ?? "unknown",
        rules: skill.frontmatter.verification?.structural?.length ?? 0,
      };
      p.log.info(
        pc.dim(
          `  Files: ${stats.files} | Sections: ${stats.sections} | Risk: ${stats.risk} | Rules: ${stats.rules}`,
        ),
      );
    } else {
      p.log.error(`Validation failed:`);
      for (const err of result.errors ?? []) {
        p.log.error(`  ${pc.red("✗")} ${err}`);
      }
    }
  } catch (err) {
    p.log.error(`Parse error: ${toErrorMessage(err)}`);
  }
}

/**
 * `dojops skills cache` — manage the local skill cache for offline use.
 *
 * Usage:
 *   dojops skills cache                     # sync skills to local cache
 *   dojops skills cache --list              # list cached skills
 *   dojops skills cache --bundle <path>     # export to bundle for air-gapped transfer
 *   dojops skills cache --import <path>     # import skills from a bundle directory
 */
export const skillsCacheCommand: CommandHandler = async (args, ctx) => {
  const rootDir = findProjectRoot() ?? process.cwd();
  const isJson = ctx.globalOpts.output === "json";

  // --list: show cached skills
  if (hasFlag(args, "--list")) {
    const cached = listCachedSkills(rootDir);
    if (isJson) {
      console.log(JSON.stringify(cached, null, 2));
      return;
    }
    if (cached.length === 0) {
      p.log.info("No cached skills. Run `dojops skills cache` to populate.");
      return;
    }
    p.log.info(`${cached.length} cached skill(s):`);
    for (const skill of cached) {
      const size = (skill.sizeBytes / 1024).toFixed(1);
      console.log(`  ${pc.cyan(skill.name)} ${pc.dim(`(${size} KB)`)}`);
    }
    return;
  }

  // --bundle <path>: export skills to a bundle directory
  const bundlePath = extractFlagValue(args, "--bundle");
  if (bundlePath) {
    const resolvedPath = path.resolve(bundlePath);
    const spinner = p.spinner();
    if (!isJson) spinner.start("Exporting skills bundle...");

    try {
      const result = exportSkillBundle(resolvedPath, rootDir);
      if (!isJson) spinner.stop("Export complete");
      if (isJson) {
        console.log(JSON.stringify({ exported: result.count, path: resolvedPath }));
      } else {
        p.log.success(`Exported ${result.count} skill(s) to ${pc.underline(resolvedPath)}`);
      }
    } catch (err) {
      if (!isJson) spinner.stop("Export failed");
      throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
    }
    return;
  }

  // --import <path>: import skills from a bundle directory
  const importPath = extractFlagValue(args, "--import");
  if (importPath) {
    const resolvedPath = path.resolve(importPath);
    const spinner = p.spinner();
    if (!isJson) spinner.start("Importing skills bundle...");

    try {
      const result = importSkillBundle(resolvedPath);
      if (!isJson) spinner.stop("Import complete");
      if (isJson) {
        console.log(JSON.stringify({ imported: result.count, path: resolvedPath }));
      } else {
        p.log.success(`Imported ${result.count} skill(s) from ${pc.underline(resolvedPath)}`);
      }
    } catch (err) {
      if (!isJson) spinner.stop("Import failed");
      throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
    }
    return;
  }

  // Default: sync skills to cache
  const spinner = p.spinner();
  if (!isJson) spinner.start("Syncing skills to local cache...");

  ensureSkillCache(rootDir);
  const cached = listCachedSkills(rootDir);

  if (!isJson) spinner.stop("Cache updated");
  if (isJson) {
    console.log(JSON.stringify({ cached: cached.length, skills: cached }));
  } else {
    p.log.success(`Skill cache updated: ${cached.length} skill(s) cached`);
  }
};
