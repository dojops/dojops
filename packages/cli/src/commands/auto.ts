import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { AGENT_TOOLS } from "@dojops/core";
import type { ToolCall, ToolDefinition } from "@dojops/core";
import { ToolExecutor, createCheckpoint } from "@dojops/executor";
import type { McpToolDispatcher as McpToolDispatcherType } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import type { AgentLoopResult } from "@dojops/session";
import { createTools } from "@dojops/api";
import { CLIContext } from "../types";
import { stripFlags, extractFlagValue, hasFlag } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { readPromptFile } from "../stdin";
import { findProjectRoot } from "../state";
import { expandFileReferences } from "../input-expander";
import { emitStreamEvent } from "../stream-json";
import {
  writeRunMeta,
  updateRunStatus,
  writeRunResult,
  outputLogPath,
  runDir,
  RunMeta,
} from "../runs";
import { queryMemory, buildMemoryContextString, recordTask, loadMemoryConfig } from "../memory";
import type { TaskType } from "../memory";

/**
 * Strip JSON wrapper from text for human-readable display.
 * Safety net: if the AgentLoop's summary extraction missed a JSON wrapper
 * (e.g. truncated JSON, non-standard format), this catches it at display time.
 */
function cleanDisplayText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;

  // Try JSON.parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed.tool_calls)) {
      const done = (
        parsed.tool_calls as Array<{ name?: string; arguments?: Record<string, unknown> }>
      ).find((tc) => tc.name === "done");
      if (done?.arguments?.summary && typeof done.arguments.summary === "string") {
        return done.arguments.summary;
      }
    }
    if (typeof parsed.summary === "string") return parsed.summary;
  } catch {
    // Malformed JSON — try regex
  }

  // Regex fallback for "summary" value in truncated JSON
  const match = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(trimmed);
  if (match) {
    return match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }

  return text;
}

/** Summarize tool call arguments for display. */
function summarizeArgs(call: ToolCall): string {
  if (call.name === "read_file" || call.name === "write_file" || call.name === "edit_file") {
    return pc.dim(call.arguments.path as string);
  }
  if (call.name === "run_command") {
    const cmd = call.arguments.command as string;
    return pc.dim(cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd);
  }
  if (call.name === "run_skill") {
    return pc.dim(call.arguments.skill as string);
  }
  if (call.name === "search_files") {
    return pc.dim(
      (call.arguments.pattern as string) || (call.arguments.content_pattern as string) || "",
    );
  }
  if (call.name === "done") {
    return pc.dim("completing...");
  }
  return "";
}

/** Probe which CLI binaries are available on PATH. */
const PROBE_BINARIES = [
  "terraform",
  "kubectl",
  "helm",
  "docker",
  "docker-compose",
  "ansible",
  "ansible-playbook",
  "nginx",
  "make",
  "git",
  "npm",
  "node",
  "pnpm",
  "yarn",
  "npx",
  "python3",
  "pip3",
  "go",
  "cargo",
  "java",
  "mvn",
  "gradle",
  "aws",
  "az",
  "gcloud",
  "gh",
  "trivy",
  "hadolint",
  "shellcheck",
  "actionlint",
  "promtool",
  "semgrep",
  "gitleaks",
  "checkov",
  "curl",
  "wget",
  "jq",
  "yq",
];

function discoverAvailableBinaries(): string[] {
  return PROBE_BINARIES.filter((bin) => {
    try {
      execFileSync("which", [bin], { encoding: "utf-8", timeout: 2_000, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Correct validation commands for available CLI tools.
 * The LLM hallucinates flags (e.g. "docker build --dry-run") when not guided,
 * so we provide the exact commands to use.
 */
const VALIDATION_COMMANDS: Record<string, { cmd: string; note?: string }> = {
  docker: {
    cmd: "docker build -f <file> . --no-cache --progress=plain 2>&1 | head -20",
    note: "Docker has NO --dry-run flag. Use build to verify syntax.",
  },
  "docker-compose": {
    cmd: "docker-compose -f <file> config --quiet",
    note: "Validates syntax. Requires referenced .env files to exist — skip if .env is missing.",
  },
  terraform: { cmd: "terraform validate" },
  kubectl: { cmd: "kubectl apply -f <file> --dry-run=client" },
  helm: { cmd: "helm lint <chart-dir>" },
  ansible: { cmd: "ansible-playbook --syntax-check <file>" },
  "ansible-playbook": { cmd: "ansible-playbook --syntax-check <file>" },
  nginx: { cmd: "nginx -t -c <file>" },
  make: { cmd: "make -n -f <file>", note: "-n prints commands without executing" },
  actionlint: {
    cmd: "actionlint -shellcheck= <file>",
    note: "-shellcheck= disables shellcheck dependency",
  },
  hadolint: { cmd: "hadolint <file>" },
  shellcheck: { cmd: "shellcheck <file>" },
  promtool: { cmd: "promtool check config <file>" },
  trivy: { cmd: "trivy config <file>" },
  checkov: { cmd: "checkov -f <file>" },
};

/**
 * Build a validation cheatsheet section for the system prompt.
 * Only includes commands for tools that are actually available.
 */
function buildValidationCheatsheet(availableBinaries: string[]): string {
  const lines: string[] = [];
  for (const bin of availableBinaries) {
    const entry = VALIDATION_COMMANDS[bin];
    if (!entry) continue;
    const line = entry.note
      ? `- ${bin}: \`${entry.cmd}\` — ${entry.note}`
      : `- ${bin}: \`${entry.cmd}\``;
    lines.push(line);
  }
  if (lines.length === 0) return "";
  return `\n\nValidation commands — use ONLY these exact commands (do NOT invent flags):
${lines.join("\n")}
Do NOT use python/pip for YAML validation. Do NOT add flags not listed above (e.g. no --dry-run for docker build).`;
}

/** Build the system prompt for autonomous agent mode. */
function buildAutoSystemPrompt(
  cwd: string,
  skillNames: string[],
  availableBinaries: string[],
): string {
  let prompt = `You are DojOps, an autonomous DevOps AI agent. You operate in the directory: ${cwd}

CRITICAL: You MUST use tools to complete tasks. NEVER output file contents as text in your response.
When the task requires creating or modifying files, you MUST call write_file or edit_file.
When the task requires running commands, you MUST call run_command.
Text-only responses are NOT acceptable when the user asks you to create, modify, or generate anything.

You have exactly 7 tools: read_file, write_file, edit_file, run_command, run_skill, search_files, done.
Do NOT call tools by any other name. To use a DojOps skill, call run_skill with the skill name as a parameter — do NOT call the skill name directly as a tool.

Workflow:
1. Use search_files and read_file to understand the project structure
2. For each requested DevOps config: call run_skill to generate it, then IMMEDIATELY write the output to disk with write_file. run_skill returns text — it does NOT create files.
3. For non-DevOps files: create with write_file or modify with edit_file
4. Optionally run commands (build, test, lint) to verify your changes
5. Once ALL requested files are written to disk, call "done" with a summary of every file created

Example for run_skill: run_skill({ skill: "dockerfile", input: { prompt: "Create Dockerfile for Node.js 20 app with multi-stage build" } }) → then write_file the result

Before EACH tool call, briefly state:
1. What you're about to do and why
2. What you expect to happen
3. How this advances the overall goal
This reasoning trace helps with debugging and ensures deliberate action.

Rules:
- Always read relevant files before making changes
- Prefer edit_file over write_file for modifying existing files
- Create directories with run_command (mkdir -p) before writing files into them
- Be precise with edits: old_string must match the file content exactly
- If a command fails, read the error output and adapt your approach — do NOT retry the same action
- Verify your changes work by running build/test/lint commands
- Call "done" when finished, with a clear summary of what was created or changed
- If search_files returns "No files found", the file does not exist — do NOT retry with different argument formats
- If you notice you are repeating the same action, STOP and reassess your approach

Efficiency rules (save tokens, avoid wasted iterations):
- ONLY use CLI tools listed in "Available CLI tools" below. If a tool is NOT listed, it is NOT installed — do NOT attempt to use it, do NOT try to install it. You will get a "[TOOL NOT INSTALLED]" error if you try.
- For validation, use ONLY the exact commands in "Validation commands" below. Do NOT invent flags, do NOT add flags not listed.
- Do NOT use python/pip for YAML/JSON validation (pyyaml may not be installed). Use the listed validation tools or skip validation.
- Do NOT install packages globally (no "pip install", "npm install -g", "gem install", "apt-get install"). Work with what is available.
- Do NOT write or modify .env files — they are blocked by security policy. If the project needs environment variables, document them in a README or docker-compose.yml instead.
- When edit_file fails with "old_string not unique" or "not found", read the file first to see the exact content before retrying.
- Prefer run_skill over manual file writing for DevOps configs — skills produce validated, best-practice output.
- IMPORTANT: run_skill returns generated content as TEXT — it does NOT write files to disk. You MUST use write_file to save the content after run_skill.
- Do NOT call "done" until ALL requested files have been written to disk with write_file. The system will reject premature done calls if no files were created.
- Complete ALL parts of the user's request before calling "done". If the user asks for 3 files, create all 3.`;

  if (skillNames.length > 0) {
    prompt += `\n\nAvailable DojOps skills (use with run_skill tool — use these EXACT names):
${skillNames.map((n) => `- ${n}`).join("\n")}
Do NOT invent skill names or add suffixes like "-chart", "-config", "-file". Use the exact names above.`;
  }

  if (availableBinaries.length > 0) {
    prompt += `\n\nAvailable CLI tools (use with run_command) — ONLY these are installed:
${availableBinaries.join(", ")}
Do NOT attempt to use any CLI tool not in this list — it will fail and waste an iteration.`;

    // Build a validation command cheatsheet from available binaries
    prompt += buildValidationCheatsheet(availableBinaries);
  } else {
    prompt += `\n\nNo external CLI tools are installed. Do NOT attempt to run validation tools (hadolint, shellcheck, yamllint, etc.) — they will fail. Rely on run_skill for generating validated configurations.`;
  }

  return prompt;
}

// ── Prompt resolution ────────────────────────────────────────────

function resolveAutoPrompt(
  args: string[],
  ctx: CLIContext,
): { prompt: string; useVoice: boolean; inlinePrompt: string } {
  const useVoice = hasFlag(args, "--voice");
  const inlinePrompt = stripFlags(
    args,
    new Set([
      "--skip-verify",
      "--force",
      "--allow-all-paths",
      "--commit",
      "--background",
      "--_background-child",
      "--voice",
    ]),
    new Set(["--timeout", "--repair-attempts", "--max-iterations", "--run-id"]),
  ).join(" ");

  let prompt = inlinePrompt;
  if (ctx.globalOpts.file) {
    const fileContent = readPromptFile(ctx.globalOpts.file);
    prompt = inlinePrompt ? `${inlinePrompt}\n\n${fileContent}` : fileContent;
  }

  return { prompt, useVoice, inlinePrompt };
}

async function resolveVoicePrompt(prompt: string): Promise<string> {
  const { resolveVoiceConfig, voiceInput } = await import("../voice");
  const voiceConfig = resolveVoiceConfig();
  p.log.info(`${pc.cyan("Recording...")} Speak your task (press Enter to stop, max 30s)`);
  const transcribed = await voiceInput(voiceConfig);
  if (transcribed) {
    p.log.info(`${pc.dim("Transcribed:")} ${transcribed}`);
    return transcribed;
  }
  return prompt;
}

// ── Background spawning ─────────────────────────────────────────

function filterSensitiveEnv(): Record<string, string> {
  const SENSITIVE_ENV_PATTERNS = [/_API_KEY$/, /_TOKEN$/, /_SECRET$/, /_PASSWORD$/];
  // Exact key names that are always safe to pass through
  const SAFE_EXACT_KEYS = new Set([
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "DOJOPS_PROVIDER",
    "DOJOPS_MODEL",
    "DOJOPS_TEMPERATURE",
    "NODE_ENV",
    "NODE_PATH",
    "NODE_OPTIONS",
  ]);
  const filteredEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Always include explicitly safe keys
    if (SAFE_EXACT_KEYS.has(key)) {
      filteredEnv[key] = value;
      continue;
    }
    // Exclude keys matching sensitive patterns
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((pat) => pat.test(key));
    if (!isSensitive) {
      filteredEnv[key] = value;
    }
  }
  return filteredEnv;
}

function spawnBackgroundRun(prompt: string, cwd: string): void {
  const rootDir = findProjectRoot(cwd) ?? cwd;
  const runId = randomUUID();
  const dir = runDir(rootDir, runId);
  fs.mkdirSync(dir, { recursive: true });

  const meta: RunMeta = {
    id: runId,
    prompt,
    status: "running",
    pid: 0,
    startedAt: new Date().toISOString(),
  };

  const logStream = fs.openSync(outputLogPath(rootDir, runId), "w");
  const childArgs = process.argv.slice(1).filter((a) => a !== "--background");
  childArgs.push("--_background-child", `--run-id=${runId}`);

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", logStream, logStream],
    cwd,
    env: filterSensitiveEnv(),
  });

  meta.pid = child.pid ?? 0;
  writeRunMeta(rootDir, meta);
  child.unref();
  fs.closeSync(logStream);

  p.log.success(`Background run started: ${pc.cyan(runId)}`);
  p.log.info(pc.dim(`Check progress: dojops runs show ${runId.slice(0, 8)}`));
}

// ── Trust check ─────────────────────────────────────────────────

interface AutoTrustResult {
  skipCustomConfigs: boolean;
  requireApprovalForCommands: boolean;
}

function logAutoUntrustedConfigs(cfgs: {
  agents: string[];
  mcpServers: string[];
  skills: string[];
  envPassthrough: string[];
}): void {
  p.log.warn("This workspace has custom configs that haven't been trusted:");
  if (cfgs.agents.length > 0) p.log.info(`  Agents: ${cfgs.agents.join(", ")}`);
  if (cfgs.mcpServers.length > 0) p.log.info(`  MCP servers: ${cfgs.mcpServers.join(", ")}`);
  if (cfgs.skills.length > 0) p.log.info(`  Skills: ${cfgs.skills.join(", ")}`);
  if (cfgs.envPassthrough.length > 0)
    p.log.info(`  MCP servers request access to env vars: ${cfgs.envPassthrough.join(", ")}`);
}

async function resolveAutoTrustCheck(
  rootDir: string | null,
  nonInteractive: boolean,
): Promise<AutoTrustResult> {
  if (!rootDir) return { skipCustomConfigs: false, requireApprovalForCommands: false };

  const { isFolderTrusted, trustFolder } = await import("../trust");
  const trustCheck = isFolderTrusted(rootDir);
  const cfgs = trustCheck.configs;
  const hasConfigs = cfgs.agents.length > 0 || cfgs.mcpServers.length > 0 || cfgs.skills.length > 0;

  if (trustCheck.trusted || !hasConfigs) {
    return { skipCustomConfigs: false, requireApprovalForCommands: false };
  }

  if (nonInteractive) {
    p.log.warn(
      "Untrusted workspace: custom agents/MCP/skills skipped. run_command requires approval.",
    );
    return { skipCustomConfigs: true, requireApprovalForCommands: true };
  }

  logAutoUntrustedConfigs(cfgs);
  const trustDecision = await p.confirm({ message: "Trust this workspace?" });
  if (p.isCancel(trustDecision) || !trustDecision) {
    p.log.info(
      pc.dim("Skipping custom agents/MCP/skills for this session. run_command requires approval."),
    );
    return { skipCustomConfigs: true, requireApprovalForCommands: true };
  }

  trustFolder(rootDir);
  p.log.success("Workspace trusted.");
  return { skipCustomConfigs: false, requireApprovalForCommands: false };
}

// ── Skills + MCP loading ────────────────────────────────────────

async function loadSkillsMap(
  provider: ReturnType<CLIContext["getProvider"]>,
  rootDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Map<string, any>> {
  try {
    const skills = await createTools(provider, rootDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const skillsMap = new Map<string, any>(skills.map((s) => [s.name, s]));
    if (skills.length > 0) {
      p.log.info(pc.dim(`Loaded ${skills.length} skills: ${skills.map((s) => s.name).join(", ")}`));
    }
    return skillsMap;
  } catch {
    return new Map();
  }
}

interface McpResources {
  mcpDispatcher?: McpToolDispatcherType;
  mcpDisconnect?: () => Promise<void>;
  mcpTools: ToolDefinition[];
}

async function loadMcpResources(rootDir: string): Promise<McpResources> {
  try {
    const { loadMcpConfig, McpClientManager, McpToolDispatcher } = await import("@dojops/mcp");
    const mcpConfig = loadMcpConfig(rootDir);
    if (Object.keys(mcpConfig.mcpServers).length === 0) {
      return { mcpTools: [] };
    }
    const mcpManager = new McpClientManager();
    await mcpManager.connectAll(mcpConfig);
    const connected = mcpManager.getConnectedServers();
    if (connected.length === 0) return { mcpTools: [] };

    const dispatcher = new McpToolDispatcher(mcpManager);
    p.log.info(
      pc.dim(
        `Connected ${connected.length} MCP server${connected.length > 1 ? "s" : ""} (${dispatcher.getToolDefinitions().length} tools)`,
      ),
    );
    return {
      mcpDispatcher: dispatcher,
      mcpDisconnect: () => mcpManager.disconnectAll(),
      mcpTools: dispatcher.getToolDefinitions(),
    };
  } catch {
    return { mcpTools: [] };
  }
}

// ── Tool executor setup ─────────────────────────────────────────

function buildToolExecutor(
  cwd: string,
  rootDir: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skillsMap: Map<string, any>,
  mcpDispatcher: McpToolDispatcherType | undefined,
  requireApprovalForCommands: boolean,
  allowAllPaths: boolean,
  isStreamJson: boolean,
): ToolExecutor {
  const sensitiveHomePaths = ["/.ssh", "/.gnupg", "/.aws", "/.config"].map(
    (suffix) => os.homedir() + suffix,
  );
  const deniedPaths = [...sensitiveHomePaths, path.join(cwd, ".env")];

  return new ToolExecutor({
    policy: {
      allowWrite: true,
      allowedWritePaths: [cwd],
      deniedWritePaths: deniedPaths,
      allowedReadPaths: [cwd],
      enforceDevOpsAllowlist: !allowAllPaths,
      allowNetwork: false,
      allowEnvVars: [],
      timeoutMs: 30_000,
      maxFileSizeBytes: 1_048_576,
      requireApproval: requireApprovalForCommands,
      skipVerification: false,
      maxVerifyRetries: 0,
      approvalMode: requireApprovalForCommands ? "always" : "never",
      autoApproveRiskLevel: "MEDIUM",
      maxRepairAttempts: 0,
    },
    cwd,
    skills: skillsMap,
    mcpDispatcher,
    onBeforeWrite: (() => {
      let checkpointed = false;
      return () => {
        if (checkpointed) return;
        checkpointed = true;
        try {
          const cpRoot = rootDir ?? cwd;
          const entry = createCheckpoint(cpRoot, `auto-${Date.now()}`);
          if (entry) {
            p.log.info(pc.dim(`Checkpoint ${entry.id} created before first write`));
          }
        } catch {
          // Checkpointing is best-effort
        }
      };
    })(),
    onToolStart: (call) => {
      // NOSONAR — isStreamJson selects output format, not a behavioral flag
      if (isStreamJson) {
        emitStreamEvent({
          type: "tool_use",
          name: call.name,
          arguments: call.arguments as Record<string, unknown>,
        });
      } else {
        p.log.step(`${pc.cyan(call.name)} ${summarizeArgs(call)}`);
      }
    },
    onToolEnd: (call, result) => {
      // NOSONAR — isStreamJson selects output format, not a behavioral flag
      if (isStreamJson) {
        emitStreamEvent({
          type: "tool_result",
          name: call.name,
          output: result.output.slice(0, 4096),
          isError: result.isError || undefined,
        });
      } else if (result.isError) {
        p.log.warn(pc.dim(`  \u2717 ${result.output.split("\n")[0]}`));
      }
    },
  });
}

// ── Output validation gate ──────────────────────────────────────

/** File-to-skill mapping for completion validation (mirrors tool-executor.ts). */
const COMPLETION_SKILL_PATTERNS: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /^Dockerfile(\..*)?$/, skill: "dockerfile" },
  { pattern: /^docker-compose[\w.-]*\.ya?ml$/, skill: "docker-compose" },
  { pattern: /\.tf$/, skill: "terraform" },
  { pattern: /^\.github\/workflows\/.*\.ya?ml$/, skill: "github-actions" },
  { pattern: /^\.gitlab-ci\.yml$/, skill: "gitlab-ci" },
  { pattern: /^Jenkinsfile$/, skill: "jenkinsfile" },
  { pattern: /^Chart\.yaml$/, skill: "helm" },
  { pattern: /^Makefile$/, skill: "makefile" },
  { pattern: /^nginx\.conf$/, skill: "nginx" },
];

/**
 * Validate all files written by the agent before declaring done.
 * Runs skill.verify() on files matching known patterns and returns issue descriptions.
 */
async function verifyFileWithSkill(
  filePath: string,
  relPath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skill: any,
): Promise<string[]> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const result = await skill.verify({ content, filePath });
    if (result.passed) return [];
    return result.issues
      .filter((i: { severity: string }) => i.severity === "error")
      .slice(0, 3)
      .map((i: { message: string }) => `${relPath}: ${i.message}`);
  } catch {
    // Verification is best-effort
    return [];
  }
}

function findMatchingSkill(
  basename: string,
  relPath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skillsMap: Map<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | null {
  for (const { pattern, skill: skillName } of COMPLETION_SKILL_PATTERNS) {
    if (!pattern.test(basename) && !pattern.test(relPath)) continue;
    const skill = skillsMap.get(skillName);
    return skill?.verify ? skill : null;
  }
  return null;
}

async function validateWrittenFiles(
  toolExecutor: ToolExecutor,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skillsMap: Map<string, any>,
  cwd: string,
): Promise<string[]> {
  const allFiles = [...toolExecutor.getFilesWritten(), ...toolExecutor.getFilesModified()];
  if (allFiles.length === 0) {
    return [
      "No files were written to disk. You must use write_file to create each requested file before calling done.",
      "If you used run_skill, the output is returned as text — you still need to write it to disk with write_file.",
    ];
  }

  const issues: string[] = [];
  for (const filePath of allFiles) {
    const relPath = path.relative(cwd, filePath);
    const basename = path.basename(filePath);
    const skill = findMatchingSkill(basename, relPath, skillsMap);
    if (!skill) continue;
    const fileIssues = await verifyFileWithSkill(filePath, relPath, skill);
    issues.push(...fileIssues);
  }
  return issues;
}

// ── System prompt + memory ──────────────────────────────────────

function buildSystemPromptWithMemory(
  cwd: string,
  skillNames: string[],
  availableBinaries: string[],
  effectiveRootDir: string,
  memoryEnabled: boolean,
  prompt: string,
): string {
  let systemPrompt = buildAutoSystemPrompt(cwd, skillNames, availableBinaries);
  if (!memoryEnabled) return systemPrompt;

  try {
    const memCtx = queryMemory(effectiveRootDir, "generate" as TaskType, prompt);
    const contextStr = buildMemoryContextString(memCtx);
    if (contextStr) {
      systemPrompt += `\n\n## Memory Context (from previous sessions)\n${contextStr}`;
    }
  } catch {
    // Memory is non-critical
  }
  return systemPrompt;
}

// ── Model routing ───────────────────────────────────────────────

async function applyAutoModelRouting(ctx: CLIContext, prompt: string): Promise<void> {
  if (ctx.globalOpts.model) return;
  const { loadConfig, resolveProvider } = await import("../config");
  const config = loadConfig();
  if (!config.modelRouting?.enabled) return;
  const { resolveModelForPrompt, isModelCompatibleWithProvider } = await import("@dojops/core");
  const override = resolveModelForPrompt(prompt, config.modelRouting);
  if (!override) return;

  // Enforce provider isolation: reject models that belong to a different provider
  const activeProvider = resolveProvider(ctx.globalOpts.provider, config);
  if (!isModelCompatibleWithProvider(override.model, activeProvider)) {
    p.log.warn(
      pc.yellow(
        `Model routing skipped: "${override.model}" is not compatible with provider "${activeProvider}". ` +
          `Routing rules must use models from the configured provider.`,
      ),
    );
    return;
  }

  ctx.globalOpts.model = override.model;
  if (ctx.globalOpts.verbose) {
    p.log.info(pc.dim(`Model routing: ${override.reason} → ${override.model}`));
  }
}

// ── Result handling ─────────────────────────────────────────────

function displayInteractiveResult(
  result: {
    summary: string;
    filesWritten: string[];
    filesModified: string[];
    iterations: number;
    toolCalls: { length: number };
    totalTokens: number;
  },
  cwd: string,
): void {
  console.log();
  p.log.message(result.summary);

  const rel = (f: string) => (f.startsWith(cwd) ? f.slice(cwd.length + 1) : f);
  if (result.filesWritten.length > 0) {
    p.log.success(`Created: ${result.filesWritten.map((f) => pc.green(rel(f))).join(", ")}`);
  }
  if (result.filesModified.length > 0) {
    p.log.success(`Modified: ${result.filesModified.map((f) => pc.yellow(rel(f))).join(", ")}`);
  }

  p.log.info(
    pc.dim(
      `${result.iterations} iterations \u00B7 ${result.toolCalls.length} tool calls \u00B7 ${result.totalTokens.toLocaleString()} tokens`,
    ),
  );
}

function recordAutoMemory(
  effectiveRootDir: string,
  prompt: string,
  summary: string,
  result: {
    success: boolean;
    filesWritten: string[];
    filesModified: string[];
    iterations: number;
    toolCalls: { length: number };
    totalTokens: number;
  },
  startTime: number,
): void {
  try {
    recordTask(effectiveRootDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate" as TaskType,
      prompt,
      result_summary: summary.slice(0, 500),
      status: result.success ? "success" : "failure",
      duration_ms: Date.now() - startTime,
      related_files: JSON.stringify([...result.filesWritten, ...result.filesModified]),
      agent_or_skill: "auto",
      metadata: JSON.stringify({
        iterations: result.iterations,
        toolCalls: result.toolCalls.length,
        totalTokens: result.totalTokens,
      }),
    });
  } catch {
    // Memory is non-critical
  }
}

function writeBackgroundResult(
  effectiveRootDir: string,
  backgroundRunId: string,
  summary: string,
  result: {
    success: boolean;
    iterations: number;
    toolCalls: { length: number };
    totalTokens: number;
    filesWritten: string[];
    filesModified: string[];
  },
): void {
  writeRunResult(effectiveRootDir, backgroundRunId, {
    success: result.success,
    summary,
    iterations: result.iterations,
    toolCalls: result.toolCalls.length,
    totalTokens: result.totalTokens,
    filesWritten: result.filesWritten,
    filesModified: result.filesModified,
  });
  updateRunStatus(effectiveRootDir, backgroundRunId, result.success ? "completed" : "failed");
}

function emitStreamInit(ctx: CLIContext): void {
  const providerName = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
  const modelName = ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)";
  emitStreamEvent({
    type: "init",
    provider: providerName,
    model: modelName,
    timestamp: new Date().toISOString(),
  });
}

function handleAutoSuccess(
  result: AgentLoopResult,
  opts: {
    isStreamJson: boolean;
    isInteractive: boolean;
    memoryEnabled: boolean;
    isBackgroundChild: boolean;
    backgroundRunId: string | undefined;
    effectiveRootDir: string;
    cwd: string;
    prompt: string;
    startTime: number;
  },
): void {
  const summary = cleanDisplayText(result.summary);

  if (opts.isStreamJson) {
    emitStreamEvent({
      type: "result",
      content: summary,
      stats: {
        success: result.success,
        iterations: result.iterations,
        toolCalls: result.toolCalls.length,
        totalTokens: result.totalTokens,
        filesWritten: result.filesWritten,
        filesModified: result.filesModified,
      },
    });
  }

  if (opts.isInteractive) {
    displayInteractiveResult({ ...result, summary }, opts.cwd);
  }

  if (opts.memoryEnabled) {
    recordAutoMemory(opts.effectiveRootDir, opts.prompt, summary, result, opts.startTime);
  }

  if (opts.isBackgroundChild && opts.backgroundRunId) {
    writeBackgroundResult(opts.effectiveRootDir, opts.backgroundRunId, summary, result);
  }
}

function handleAutoError(
  err: unknown,
  isStreamJson: boolean,
  isBackgroundChild: boolean,
  backgroundRunId: string | undefined,
  effectiveRootDir: string,
): never {
  if (isStreamJson) {
    emitStreamEvent({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (isBackgroundChild && backgroundRunId) {
    updateRunStatus(effectiveRootDir, backgroundRunId, "failed");
  }

  const message = err instanceof Error ? err.message : String(err);
  throw new CLIError(ExitCode.GENERAL_ERROR, message);
}

async function resolvePromptFromArgs(args: string[], ctx: CLIContext): Promise<string> {
  const { prompt: initialPrompt, useVoice } = resolveAutoPrompt(args, ctx);
  let prompt = initialPrompt;

  if (useVoice && !prompt) {
    prompt = await resolveVoicePrompt(prompt);
  }

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops auto <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops auto -f prompt.md`);
    p.log.info(`  ${pc.dim("$")} dojops auto --background <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops auto --voice`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  return expandFileReferences(prompt, ctx.cwd);
}

/**
 * Autonomous agent mode: iterative tool-use loop (ReAct pattern).
 * The LLM reads files, makes changes, runs commands, and verifies — all autonomously.
 *
 * Usage: dojops auto "Create CI for Node app"
 */
export async function autoCommand(args: string[], ctx: CLIContext): Promise<void> {
  const isBackground = hasFlag(args, "--background");
  const isBackgroundChild = hasFlag(args, "--_background-child");
  const backgroundRunId = extractFlagValue(args, "--run-id");

  const prompt = await resolvePromptFromArgs(args, ctx);

  if (isBackground) {
    spawnBackgroundRun(prompt, ctx.cwd);
    return;
  }

  const maxIterations = Number.parseInt(extractFlagValue(args, "--max-iterations") ?? "50", 10);
  p.log.info(
    `${pc.bold(pc.cyan("Autonomous agent mode"))} — iterative tool-use (max ${maxIterations} iterations)`,
  );

  await applyAutoModelRouting(ctx, prompt);

  const provider = ctx.getProvider();
  const cwd = ctx.cwd;
  const rootDir = findProjectRoot(cwd);

  const { skipCustomConfigs, requireApprovalForCommands } = await resolveAutoTrustCheck(
    rootDir,
    ctx.globalOpts.nonInteractive,
  );

  const skillsMap = await loadSkillsMap(provider, rootDir ?? cwd);

  const mcpResources = skipCustomConfigs
    ? { mcpTools: [] as ToolDefinition[] }
    : await loadMcpResources(rootDir ?? cwd);

  const isStreamJson = ctx.globalOpts.output === "stream-json";
  const allowAllPaths = hasFlag(args, "--allow-all-paths");

  const toolExecutor = buildToolExecutor(
    cwd,
    rootDir,
    skillsMap,
    mcpResources.mcpDispatcher,
    requireApprovalForCommands,
    allowAllPaths,
    isStreamJson,
  );

  const availableBinaries = discoverAvailableBinaries();
  const skillNames = [...skillsMap.keys()];
  const effectiveRootDir = rootDir ?? cwd;
  const memoryEnabled = loadMemoryConfig(effectiveRootDir);

  const systemPrompt = buildSystemPromptWithMemory(
    cwd,
    skillNames,
    availableBinaries,
    effectiveRootDir,
    memoryEnabled,
    prompt,
  );

  const allTools = [...AGENT_TOOLS, ...mcpResources.mcpTools];

  const loop = new AgentLoop({
    provider,
    toolExecutor,
    tools: allTools,
    systemPrompt,
    maxIterations,
    thinking: ctx.globalOpts.thinking,
    validateBeforeDone: () => validateWrittenFiles(toolExecutor, skillsMap, cwd),
    onThinking: (text) => {
      if (!text) return;
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) return;
      const firstLine = trimmed.split("\n")[0];
      if (firstLine.length > 0) {
        p.log.info(pc.dim(firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine));
      }
    },
  });

  const startTime = Date.now();

  if (isStreamJson) {
    emitStreamInit(ctx);
  }

  const isInteractive = !isBackgroundChild && !isStreamJson;
  const s = isInteractive ? p.spinner() : null;
  s?.start("Agent working...");

  try {
    const result = await loop.run(prompt);
    s?.stop(result.success ? pc.green("Done") : pc.yellow("Stopped"));

    handleAutoSuccess(result, {
      isStreamJson,
      isInteractive,
      memoryEnabled,
      isBackgroundChild,
      backgroundRunId,
      effectiveRootDir,
      cwd,
      prompt,
      startTime,
    });
  } catch (err) {
    s?.stop("Error");
    handleAutoError(err, isStreamJson, isBackgroundChild, backgroundRunId, effectiveRootDir);
  } finally {
    if (mcpResources.mcpDisconnect) {
      await mcpResources.mcpDisconnect().catch(() => {});
    }
  }
}
