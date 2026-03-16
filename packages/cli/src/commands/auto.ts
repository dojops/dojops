import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { AGENT_TOOLS } from "@dojops/core";
import type { ToolCall } from "@dojops/core";
import { ToolExecutor } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import { createTools } from "@dojops/api";
import { CLIContext } from "../types";
import { stripFlags, extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { readPromptFile } from "../stdin";
import { findProjectRoot } from "../state";

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
  const inlinePrompt = stripFlags(
    args,
    new Set(["--skip-verify", "--force", "--allow-all-paths", "--commit"]),
    new Set(["--timeout", "--repair-attempts", "--max-iterations"]),
  ).join(" ");

  // Build prompt: file content + inline args (same pattern as plan command)
  let prompt = inlinePrompt;
  if (ctx.globalOpts.file) {
    const fileContent = readPromptFile(ctx.globalOpts.file);
    prompt = inlinePrompt ? `${inlinePrompt}\n\n${fileContent}` : fileContent;
  }

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops auto <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops auto -f prompt.md`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const maxIterations = Number.parseInt(extractFlagValue(args, "--max-iterations") ?? "50", 10);

  p.log.info(
    `${pc.bold(pc.cyan("Autonomous agent mode"))} — iterative tool-use (max ${maxIterations} iterations)`,
  );

  const provider = ctx.getProvider();
  const cwd = ctx.cwd;

  // Load skills for the run_skill tool
  const rootDir = findProjectRoot(cwd);
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
    onToolStart: (call) => {
      p.log.step(`${pc.cyan(call.name)} ${summarizeArgs(call)}`);
    },
    onToolEnd: (call, result) => {
      if (result.isError) {
        p.log.warn(pc.dim(`  ✗ ${result.output.split("\n")[0]}`));
      }
    },
  });

  // Discover available CLI binaries for the system prompt
  const availableBinaries = discoverAvailableBinaries();
  const skillNames = [...skillsMap.keys()];

  const loop = new AgentLoop({
    provider,
    toolExecutor,
    tools: AGENT_TOOLS,
    systemPrompt: buildAutoSystemPrompt(cwd, skillNames, availableBinaries),
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

  const s = p.spinner();
  s.start("Agent working...");

  try {
    const result = await loop.run(prompt);
    s.stop(result.success ? pc.green("Done") : pc.yellow("Stopped"));

    // Display summary — strip any JSON wrapper that leaked through from LLM output
    const summary = cleanDisplayText(result.summary);
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
  } catch (err) {
    s.stop("Error");
    const message = err instanceof Error ? err.message : String(err);
    throw new CLIError(ExitCode.GENERAL_ERROR, message);
  }
}
