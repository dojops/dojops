import pc from "picocolors";
import * as p from "@clack/prompts";
import { AGENT_TOOLS } from "@dojops/core";
import type { ToolCall } from "@dojops/core";
import { ToolExecutor } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import { createTools } from "@dojops/api";
import { CLIContext } from "../types";
import { hasFlag, stripFlags, extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot } from "../state";

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

/** Build the system prompt for autonomous agent mode. */
function buildAutoSystemPrompt(cwd: string): string {
  return `You are DojOps, an autonomous DevOps AI agent. You operate in the directory: ${cwd}

Your job is to complete the user's task by iteratively:
1. Reading files to understand the project structure and existing code
2. Making targeted changes using write_file or edit_file
3. Running commands to build, test, or verify your changes
4. Using run_skill for generating DevOps configurations (Terraform, Dockerfile, CI/CD, etc.)
5. Calling "done" when the task is complete

Guidelines:
- Always read relevant files before making changes
- Prefer edit_file over write_file for modifying existing files
- Run tests or build commands to verify your changes work
- Use search_files to discover project structure
- Be precise with edits — the old_string must match exactly
- If a command fails, read the error output and adapt your approach
- When done, provide a clear summary of what was accomplished`;
}

/**
 * Autonomous agent mode: iterative tool-use loop (ReAct pattern).
 * The LLM reads files, makes changes, runs commands, and verifies — all autonomously.
 *
 * Usage: dojops auto "Create CI for Node app"
 */
export async function autoCommand(args: string[], ctx: CLIContext): Promise<void> {
  const prompt = stripFlags(
    args,
    new Set(["--skip-verify", "--force", "--allow-all-paths", "--commit"]),
    new Set(["--timeout", "--repair-attempts", "--max-iterations"]),
  ).join(" ");

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops auto <prompt>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const maxIterations = parseInt(extractFlagValue(args, "--max-iterations") ?? "20", 10);
  const allowAllPaths = hasFlag(args, "--allow-all-paths");

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
      allowedWritePaths: allowAllPaths ? [cwd] : [],
      deniedWritePaths: [],
      enforceDevOpsAllowlist: !allowAllPaths,
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

  const loop = new AgentLoop({
    provider,
    toolExecutor,
    tools: AGENT_TOOLS,
    systemPrompt: buildAutoSystemPrompt(cwd),
    maxIterations,
    onThinking: (text) => {
      if (text) {
        // Show first line of thinking
        const firstLine = text.split("\n")[0];
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

    // Display summary
    console.log();
    p.log.message(result.summary);

    // Display file changes
    if (result.filesWritten.length > 0) {
      p.log.success(`Created: ${result.filesWritten.map((f) => pc.green(f)).join(", ")}`);
    }
    if (result.filesModified.length > 0) {
      p.log.success(`Modified: ${result.filesModified.map((f) => pc.yellow(f)).join(", ")}`);
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
