import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { AGENT_TOOLS } from "@dojops/core";
import type { ToolCall, ToolDefinition } from "@dojops/core";
import { ToolExecutor, createCheckpoint } from "@dojops/executor";
import type { McpToolDispatcher as McpToolDispatcherType } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
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
2. Create files with write_file or modify them with edit_file
3. Run commands (build, test, lint, validate) to verify your changes
4. Use run_skill to generate DevOps configurations (e.g. run_skill with skill="dockerfile", not a tool called "dockerfile")
5. Call "done" with a summary when the task is complete

Rules:
- Always read relevant files before making changes
- Prefer edit_file over write_file for modifying existing files
- Create directories with run_command (mkdir -p) before writing files into them
- Be precise with edits: old_string must match the file content exactly
- If a command fails, read the error output and adapt your approach
- Verify your changes work by running build/test/lint commands
- Call "done" when finished, with a clear summary of what was created or changed
- If search_files returns "No files found", the file does not exist — do NOT retry with different argument formats`;

  if (skillNames.length > 0) {
    prompt += `\n\nAvailable DojOps skills (use with run_skill tool — use these EXACT names):
${skillNames.map((n) => `- ${n}`).join("\n")}
Do NOT invent skill names or add suffixes like "-chart", "-config", "-file". Use the exact names above.`;
  }

  if (availableBinaries.length > 0) {
    prompt += `\n\nAvailable CLI tools (use with run_command):
${availableBinaries.join(", ")}
Use these for validation (e.g. terraform validate, helm lint, kubectl --dry-run), builds, tests, and deployments.`;
  }

  return prompt;
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

  // Build prompt: file content + inline args (same pattern as plan command)
  let prompt = inlinePrompt;
  if (ctx.globalOpts.file) {
    const fileContent = readPromptFile(ctx.globalOpts.file);
    prompt = inlinePrompt ? `${inlinePrompt}\n\n${fileContent}` : fileContent;
  }

  // Voice input: record + transcribe when --voice flag is set and no text prompt
  if (useVoice && !prompt) {
    const { resolveVoiceConfig, voiceInput } = await import("../voice");
    const voiceConfig = resolveVoiceConfig();
    p.log.info(`${pc.cyan("Recording...")} Speak your task (press Enter to stop, max 30s)`);
    const transcribed = await voiceInput(voiceConfig);
    if (transcribed) {
      p.log.info(`${pc.dim("Transcribed:")} ${transcribed}`);
      prompt = transcribed;
    }
  }

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops auto <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops auto -f prompt.md`);
    p.log.info(`  ${pc.dim("$")} dojops auto --background <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops auto --voice`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  // Expand @file references in the prompt
  prompt = expandFileReferences(prompt, ctx.cwd);

  // ── Background spawning ──────────────────────────────────────────
  if (isBackground) {
    const rootDir = findProjectRoot(ctx.cwd) ?? ctx.cwd;
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

    // Re-build argv: replace --background with --_background-child + --run-id
    const childArgs = process.argv.slice(1).filter((a) => a !== "--background");
    childArgs.push("--_background-child", `--run-id=${runId}`);

    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ["ignore", logStream, logStream],
      cwd: ctx.cwd,
      env: process.env,
    });

    meta.pid = child.pid ?? 0;
    writeRunMeta(rootDir, meta);
    child.unref();
    fs.closeSync(logStream);

    p.log.success(`Background run started: ${pc.cyan(runId)}`);
    p.log.info(pc.dim(`Check progress: dojops runs show ${runId.slice(0, 8)}`));
    return;
  }

  const maxIterations = Number.parseInt(extractFlagValue(args, "--max-iterations") ?? "50", 10);

  p.log.info(
    `${pc.bold(pc.cyan("Autonomous agent mode"))} — iterative tool-use (max ${maxIterations} iterations)`,
  );

  // ── Model routing: override model for simple/complex prompts ───
  if (!ctx.globalOpts.model) {
    const { loadConfig } = await import("../config");
    const config = loadConfig();
    if (config.modelRouting?.enabled) {
      const { resolveModelForPrompt } = await import("@dojops/core");
      const override = resolveModelForPrompt(prompt, config.modelRouting);
      if (override) {
        ctx.globalOpts.model = override.model;
        if (ctx.globalOpts.verbose) {
          p.log.info(pc.dim(`Model routing: ${override.reason} → ${override.model}`));
        }
      }
    }
  }

  const provider = ctx.getProvider();
  const cwd = ctx.cwd;

  // Load skills for the run_skill tool
  const rootDir = findProjectRoot(cwd);

  // ── Trust check: gate custom agents/MCP/skills ─────────────────
  let skipCustomConfigs = false;
  if (rootDir) {
    const { isFolderTrusted, trustFolder } = await import("../trust");
    const trustCheck = isFolderTrusted(rootDir);
    const cfgs = trustCheck.configs;
    const hasConfigs =
      cfgs.agents.length > 0 || cfgs.mcpServers.length > 0 || cfgs.skills.length > 0;
    if (!trustCheck.trusted && hasConfigs && !ctx.globalOpts.nonInteractive) {
      p.log.warn("This workspace has custom configs that haven't been trusted:");
      if (cfgs.agents.length > 0) p.log.info(`  Agents: ${cfgs.agents.join(", ")}`);
      if (cfgs.mcpServers.length > 0) p.log.info(`  MCP servers: ${cfgs.mcpServers.join(", ")}`);
      if (cfgs.skills.length > 0) p.log.info(`  Skills: ${cfgs.skills.join(", ")}`);
      const trustDecision = await p.confirm({ message: "Trust this workspace?" });
      if (p.isCancel(trustDecision) || !trustDecision) {
        skipCustomConfigs = true;
        p.log.info(pc.dim("Skipping custom agents/MCP/skills for this session."));
      } else {
        trustFolder(rootDir);
        p.log.success("Workspace trusted.");
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let skillsMap = new Map<string, any>();
  try {
    const skills = await createTools(provider, rootDir ?? cwd);
    skillsMap = new Map(skills.map((s) => [s.name, s]));
    if (skills.length > 0) {
      p.log.info(pc.dim(`Loaded ${skills.length} skills: ${skills.map((s) => s.name).join(", ")}`));
    }
  } catch {
    // Skills loading is optional — agent can still read/write/run commands
  }

  // Load MCP tools (optional — external tool servers, skipped if untrusted)
  let mcpDispatcher: McpToolDispatcherType | undefined;
  let mcpDisconnect: (() => Promise<void>) | undefined;
  let mcpTools: ToolDefinition[] = [];
  if (!skipCustomConfigs)
    try {
      const { loadMcpConfig, McpClientManager, McpToolDispatcher } = await import("@dojops/mcp");
      const mcpConfig = loadMcpConfig(rootDir ?? cwd);
      if (Object.keys(mcpConfig.mcpServers).length > 0) {
        const mcpManager = new McpClientManager();
        await mcpManager.connectAll(mcpConfig);
        const connected = mcpManager.getConnectedServers();
        if (connected.length > 0) {
          const dispatcher = new McpToolDispatcher(mcpManager);
          mcpDispatcher = dispatcher;
          mcpTools = dispatcher.getToolDefinitions();
          mcpDisconnect = () => mcpManager.disconnectAll();
          p.log.info(
            pc.dim(
              `Connected ${connected.length} MCP server${connected.length > 1 ? "s" : ""} (${mcpTools.length} tools)`,
            ),
          );
        }
      }
    } catch {
      // MCP is optional — @dojops/mcp may not be installed or config may not exist
    }

  const isStreamJson = ctx.globalOpts.output === "stream-json";

  const toolExecutor = new ToolExecutor({
    policy: {
      allowWrite: true,
      allowedWritePaths: [cwd],
      deniedWritePaths: [],
      enforceDevOpsAllowlist: false,
      allowNetwork: false,
      allowEnvVars: [],
      timeoutMs: 30_000,
      maxFileSizeBytes: 1_048_576,
      requireApproval: false,
      skipVerification: false,
      maxVerifyRetries: 0,
      approvalMode: "never",
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
          // Checkpointing is best-effort — don't block the agent
        }
      };
    })(),
    onToolStart: (call) => {
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
      if (isStreamJson) {
        emitStreamEvent({
          type: "tool_result",
          name: call.name,
          output: result.output.slice(0, 4096),
          isError: result.isError || undefined,
        });
      } else if (result.isError) {
        p.log.warn(pc.dim(`  ✗ ${result.output.split("\n")[0]}`));
      }
    },
  });

  // Discover available CLI binaries for the system prompt
  const availableBinaries = discoverAvailableBinaries();
  const skillNames = [...skillsMap.keys()];

  const allTools = [...AGENT_TOOLS, ...mcpTools];

  // ── Auto-memory: inject context from previous sessions ───────────
  let systemPrompt = buildAutoSystemPrompt(cwd, skillNames, availableBinaries);
  const effectiveRootDir = rootDir ?? cwd;
  const memoryEnabled = loadMemoryConfig(effectiveRootDir);

  if (memoryEnabled) {
    try {
      const memCtx = queryMemory(effectiveRootDir, "generate" as TaskType, prompt);
      const contextStr = buildMemoryContextString(memCtx);
      if (contextStr) {
        systemPrompt += `\n\n## Memory Context (from previous sessions)\n${contextStr}`;
      }
    } catch {
      // Memory is non-critical — continue without it
    }
  }

  const loop = new AgentLoop({
    provider,
    toolExecutor,
    tools: allTools,
    systemPrompt,
    maxIterations,
    onThinking: (text) => {
      if (text) {
        // Skip raw JSON output (e.g. LLM returning tool calls as text)
        const trimmed = text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) return;
        const firstLine = trimmed.split("\n")[0];
        if (firstLine.length > 0) {
          p.log.info(pc.dim(firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine));
        }
      }
    },
  });

  const startTime = Date.now();

  // Stream-JSON: emit init event
  if (isStreamJson) {
    const provider = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
    const model = ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)";
    emitStreamEvent({ type: "init", provider, model, timestamp: new Date().toISOString() });
  }

  // Background child: suppress interactive output
  const isInteractive = !isBackgroundChild && !isStreamJson;
  const s = isInteractive ? p.spinner() : null;
  s?.start("Agent working...");

  try {
    const result = await loop.run(prompt);
    s?.stop(result.success ? pc.green("Done") : pc.yellow("Stopped"));

    // Display summary — strip any JSON wrapper that leaked through from LLM output
    const summary = cleanDisplayText(result.summary);

    // Stream-JSON: emit final result event
    if (isStreamJson) {
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

    if (isInteractive) {
      console.log();
      p.log.message(summary);

      // Display file changes (relative to cwd for readability)
      const rel = (f: string) => (f.startsWith(cwd) ? f.slice(cwd.length + 1) : f);
      if (result.filesWritten.length > 0) {
        p.log.success(`Created: ${result.filesWritten.map((f) => pc.green(rel(f))).join(", ")}`);
      }
      if (result.filesModified.length > 0) {
        p.log.success(`Modified: ${result.filesModified.map((f) => pc.yellow(rel(f))).join(", ")}`);
      }

      // Display stats
      p.log.info(
        pc.dim(
          `${result.iterations} iterations · ${result.toolCalls.length} tool calls · ${result.totalTokens.toLocaleString()} tokens`,
        ),
      );
    }

    // ── Auto-memory: record completed task ───────────────────────────
    if (memoryEnabled) {
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

    // ── Background child: write result and update meta ──────────────
    if (isBackgroundChild && backgroundRunId) {
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
  } catch (err) {
    s?.stop("Error");

    // Stream-JSON: emit error event
    if (isStreamJson) {
      emitStreamEvent({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // Background child: mark run as failed
    if (isBackgroundChild && backgroundRunId) {
      updateRunStatus(effectiveRootDir, backgroundRunId, "failed");
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new CLIError(ExitCode.GENERAL_ERROR, message);
  } finally {
    // Disconnect MCP servers (best-effort)
    if (mcpDisconnect) {
      await mcpDisconnect().catch(() => {});
    }
  }
}
