import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ExecutionPolicy } from "./types";
import { checkWriteAllowed, checkFileSize, isPathWithin } from "./policy";
import { scanForSecrets } from "./secret-scanner";
import type { ToolCall, ToolResult, ToolDefinition } from "@dojops/core";
import { resolveToolName } from "@dojops/sdk";
import type { DevOpsSkill } from "@dojops/sdk";

/** Interface for an MCP tool dispatcher that can handle mcp__-prefixed tool calls. */
export interface McpToolDispatcher {
  isConnected(): boolean;
  canHandle(toolName: string): boolean;
  getToolDefinitions(): ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
}

/** Maximum tool output size before truncation (32KB). */
const MAX_OUTPUT_BYTES = 32_768;

/**
 * Static mapping: file basename patterns → skill names.
 * Used to detect when write_file produces a file that a skill can verify.
 */
const FILE_TO_SKILL: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /^Dockerfile(\..*)?$/, skill: "dockerfile" },
  { pattern: /^\.dockerignore$/, skill: "dockerfile" },
  { pattern: /^docker-compose[\w.-]*\.ya?ml$/, skill: "docker-compose" },
  { pattern: /\.tf$/, skill: "terraform" },
  { pattern: /^\.github\/workflows\/.*\.ya?ml$/, skill: "github-actions" },
  { pattern: /^\.gitlab-ci\.yml$/, skill: "gitlab-ci" },
  { pattern: /^Jenkinsfile$/, skill: "jenkinsfile" },
  { pattern: /^Chart\.yaml$/, skill: "helm" },
  { pattern: /^values\.yaml$/, skill: "helm" },
  { pattern: /^Makefile$/, skill: "makefile" },
  { pattern: /^nginx\.conf$/, skill: "nginx" },
  { pattern: /^playbook[\w.-]*\.ya?ml$/, skill: "ansible" },
  { pattern: /^prometheus[\w.-]*\.ya?ml$/, skill: "prometheus" },
  { pattern: /^.*\.service$/, skill: "systemd" },
];

/** Maximum allowed search pattern length. */
const MAX_PATTERN_LENGTH = 200;

/** Maximum search results from find/grep commands. */
const MAX_SEARCH_RESULTS = 1000;

/** Standard env vars always passed through regardless of allowEnvVars policy. */
const STANDARD_ENV_VARS = new Set(["PATH", "HOME", "USER", "SHELL"]);

/** Network-related commands that trigger policy warnings. */
const NETWORK_COMMANDS = ["curl", "wget", "fetch", "ssh", "scp", "nc", "telnet"];

/**
 * Dangerous command patterns that indicate potential command injection / RCE.
 * Each entry has a regex pattern and a human-readable reason.
 */
const DANGEROUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // More specific patterns first to ensure correct match priority
  {
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|dash|ksh|python[23]?|node|perl|ruby)\b/,
    reason: "Remote code download piped to interpreter",
  },
  { pattern: /\|\s*(sh|bash|zsh|dash|ksh)\b/, reason: "Pipe to shell interpreter" },
  { pattern: /\|\s*python[23]?\b/, reason: "Pipe to Python interpreter" },
  { pattern: /\|\s*node\b/, reason: "Pipe to Node.js interpreter" },
  { pattern: /\|\s*perl\b/, reason: "Pipe to Perl interpreter" },
  { pattern: /\|\s*ruby\b/, reason: "Pipe to Ruby interpreter" },
  { pattern: /\beval\s+/, reason: "eval command execution" },
  { pattern: /\bexec\s+/, reason: "exec command execution" },
  { pattern: /`[^`]+`/, reason: "Backtick subshell execution" },
  { pattern: /\$\([^)]+\)/, reason: "Command substitution" },
  // CS-12: PowerShell patterns
  { pattern: /\bpowershell\b/i, reason: "PowerShell execution" },
  { pattern: /\bpwsh\b/i, reason: "PowerShell Core execution" },
  { pattern: /Invoke-Expression/i, reason: "PowerShell Invoke-Expression" },
  { pattern: /\bIEX\b/, reason: "PowerShell IEX (Invoke-Expression alias)" },
  // SA-15: Additional injection patterns
  {
    pattern: /\benv\s+(sh|bash|zsh|dash|ksh|python[23]?|node|perl|ruby)\b/,
    reason: "env interpreter execution",
  },
  { pattern: /base64.*\|\s*(sh|bash)/, reason: "Base64 decode piped to shell" },
  { pattern: /<\(/, reason: "Process substitution" },
];

/**
 * Check if a command contains dangerous patterns that could enable RCE.
 * Returns an object indicating whether the command is dangerous and why.
 */
export function isDangerousCommand(cmd: string): { dangerous: boolean; reason: string } {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return { dangerous: true, reason };
    }
  }
  return { dangerous: false, reason: "" };
}

function findBlockedNetworkCommand(command: string): string | null {
  for (const netCmd of NETWORK_COMMANDS) {
    if (new RegExp(`\\b${netCmd}\\b`).test(command)) return netCmd;
  }
  return null;
}

/**
 * Parse a command string into an array of arguments, respecting quoted strings.
 * Does NOT invoke a shell — the caller uses execFileSync(binary, args).
 */
function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inSingleQuote) {
      if (ch === "'") {
        inSingleQuote = false;
      } else {
        current += ch;
      }
    } else if (inDoubleQuote) {
      if (ch === '"') {
        inDoubleQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) args.push(current);
  return args;
}

function validateSearchPatterns(
  callId: string,
  rawPattern: string | undefined,
  contentPattern: string | undefined,
): ToolResult | null {
  if (!rawPattern && !contentPattern) {
    return {
      callId,
      output:
        "No search criteria provided. Use 'pattern' for file name matching and/or 'content_pattern' for content search.",
      isError: true,
    };
  }
  if (rawPattern && rawPattern.length > MAX_PATTERN_LENGTH) {
    return {
      callId,
      output: `File pattern too long (${rawPattern.length} chars, max ${MAX_PATTERN_LENGTH}). Provide a more specific pattern.`,
      isError: true,
    };
  }
  if (contentPattern && contentPattern.length > MAX_PATTERN_LENGTH) {
    return {
      callId,
      output: `Content pattern too long (${contentPattern.length} chars, max ${MAX_PATTERN_LENGTH}). Provide a more specific pattern.`,
      isError: true,
    };
  }
  if (contentPattern && /^(\.\*|\.\+)$/.test(contentPattern.trim())) {
    return {
      callId,
      output: `Content pattern "${contentPattern}" is too broad. Provide a more specific pattern.`,
      isError: true,
    };
  }
  return null;
}

export interface ToolExecutorOptions {
  policy: ExecutionPolicy;
  cwd: string;
  skills?: Map<string, DevOpsSkill>;
  mcpDispatcher?: McpToolDispatcher;
  onToolStart?: (call: ToolCall) => void;
  onToolEnd?: (call: ToolCall, result: ToolResult) => void;
  /** Called before any file write/edit — use for checkpointing. */
  onBeforeWrite?: (filePath: string) => void;
  /** Called when a policy violation is detected but not blocking (advisory warnings). */
  onPolicyWarning?: (message: string) => void;
  /** Skip secret scanning on write/edit operations. Default false. */
  skipSecretScan?: boolean;
  /** Max repair attempts for skill verification failures (default 0 = no retry). */
  skillRepairAttempts?: number;
}

/** Truncate output to fit within the context budget. */
function truncateOutput(output: string): string {
  if (Buffer.byteLength(output, "utf-8") <= MAX_OUTPUT_BYTES) return output;
  const truncated = output.slice(0, MAX_OUTPUT_BYTES);
  return `${truncated}\n\n[truncated — output exceeded ${MAX_OUTPUT_BYTES} bytes]`;
}

/**
 * Extract directory components from glob patterns.
 * LLMs often combine directory + glob into the pattern field (e.g. "terraform-iac/**\/*.tf")
 * instead of using the path argument for directories and pattern for just the filename glob.
 * find -name only matches basenames, so "terraform-iac/**\/*.tf" would always return zero results.
 */
function normalizeSearchPattern(
  pattern: string,
  basePath: string,
): { pattern: string; searchPath: string } {
  if (!pattern.includes("/")) return { pattern, searchPath: basePath };

  const segments = pattern.split("/");
  const dirSegments: string[] = [];

  // Collect concrete directory segments, stop at globs
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg === "**" || seg === "*") continue;
    if (seg.includes("*") || seg.includes("?")) break;
    dirSegments.push(seg);
  }

  // Last segment is the filename pattern
  const lastSeg = segments[segments.length - 1];
  const filePattern = lastSeg && lastSeg !== "**" ? lastSeg : "*";

  if (dirSegments.length === 0) {
    return { pattern: filePattern, searchPath: basePath };
  }

  // Only use resolved dir if it actually exists
  const resolvedDir = path.resolve(basePath, dirSegments.join("/"));
  if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
    return { pattern: filePattern, searchPath: resolvedDir };
  }

  return { pattern: filePattern, searchPath: basePath };
}

/** Search for files by name pattern using find with safe array args (no shell). */
function searchByFilePattern(pattern: string, searchPath: string): string[] {
  try {
    const output = execFileSync(
      "find",
      [searchPath, "-type", "f", "-name", pattern, "-maxdepth", "10"],
      {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: MAX_OUTPUT_BYTES,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = output.trim().split("\n").filter(Boolean).slice(0, MAX_SEARCH_RESULTS);
    if (lines.length > 0) return [`Files matching "${pattern}":\n${lines.join("\n")}`];
    return [];
  } catch {
    return searchByPathPattern(pattern, searchPath);
  }
}

/** Fallback file search using -path for glob/wildcard patterns. */
function searchByPathPattern(pattern: string, searchPath: string): string[] {
  try {
    // Ensure pattern has wildcard prefix for -path matching
    const pathPattern = pattern.startsWith("*") ? pattern : `*${pattern}`;
    const output = execFileSync(
      "find",
      [searchPath, "-type", "f", "-path", pathPattern, "-maxdepth", "10"],
      {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: MAX_OUTPUT_BYTES,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = output.trim().split("\n").filter(Boolean).slice(0, MAX_SEARCH_RESULTS);
    if (lines.length > 0) return [`Files matching "${pattern}":\n${lines.join("\n")}`];
    return [];
  } catch {
    return [`No files found matching "${pattern}"`];
  }
}

/** Search for files containing a given content pattern using grep with safe array args (no shell). */
function searchByContent(contentPattern: string, searchPath: string): string[] {
  try {
    const output = execFileSync("grep", ["-rl", "--", contentPattern, searchPath], {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = output.trim().split("\n").filter(Boolean).slice(0, MAX_SEARCH_RESULTS);
    if (lines.length > 0) {
      return [`Files containing "${contentPattern}":\n${lines.join("\n")}`];
    }
    return [`No files containing "${contentPattern}"`];
  } catch {
    return [`No files containing "${contentPattern}"`];
  }
}

/**
 * Dispatches tool calls to sandboxed operations, enforced by ExecutionPolicy.
 * Each tool call maps to a specific file system or process operation.
 */
export class ToolExecutor {
  private readonly filesWritten = new Set<string>();
  private readonly filesModified = new Set<string>();

  constructor(private readonly opts: ToolExecutorOptions) {}

  /** Get list of files written during this executor's lifetime. */
  getFilesWritten(): string[] {
    return [...this.filesWritten];
  }

  /** Get list of files modified during this executor's lifetime. */
  getFilesModified(): string[] {
    return [...this.filesModified];
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    this.opts.onToolStart?.(call);
    let result: ToolResult;

    try {
      switch (call.name) {
        case "read_file":
          result = await this.readFile(call);
          break;
        case "write_file":
          result = await this.writeFile(call);
          break;
        case "edit_file":
          result = await this.editFile(call);
          break;
        case "run_command":
          result = await this.runCommand(call);
          break;
        case "run_skill":
          result = await this.runSkill(call);
          break;
        case "search_files":
          result = await this.searchFiles(call);
          break;
        case "done":
          result = {
            callId: call.id,
            output: (call.arguments.summary as string) ?? "Task complete.",
          };
          break;
        default:
          // Auto-redirect: if the unknown tool name matches a skill, run it as run_skill
          if (this.opts.skills && this.resolveSkill(call.name)) {
            result = await this.runSkill({
              ...call,
              name: "run_skill",
              arguments: {
                skill: call.name,
                input: call.arguments,
              },
            });
          } else if (this.opts.mcpDispatcher?.canHandle(call.name)) {
            result = await this.opts.mcpDispatcher.execute(call);
          } else {
            result = { callId: call.id, output: `Unknown tool: ${call.name}`, isError: true };
          }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { callId: call.id, output: `Error: ${message}`, isError: true };
    }

    this.opts.onToolEnd?.(call, result);
    return result;
  }

  private resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(this.opts.cwd, filePath);
  }

  /**
   * After writing a file, check if it matches a known skill pattern.
   * If so, run verify() and return advisory feedback for the agent.
   */
  private async verifyWrittenFile(filePath: string): Promise<string | null> {
    if (!this.opts.skills || this.opts.policy.skipVerification) return null;

    const relPath = path.relative(this.opts.cwd, filePath);
    const basename = path.basename(filePath);

    for (const { pattern, skill: skillName } of FILE_TO_SKILL) {
      // Match against both basename and relative path (for .github/workflows/*)
      if (!pattern.test(basename) && !pattern.test(relPath)) continue;

      const skill = this.opts.skills.get(skillName);
      if (!skill?.verify) continue;

      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const result = await skill.verify({ content, filePath });
        if (!result.passed && result.issues.length > 0) {
          const issueLines = result.issues
            .slice(0, 5)
            .map((i) => `  - ${i.message ?? i}`)
            .join("\n");
          return `\nVerification (${skillName}): ${result.issues.length} issue(s)\n${issueLines}`;
        }
      } catch {
        // Verification is advisory — don't block on failure
      }
      break;
    }
    return null;
  }

  private async readFile(call: ToolCall): Promise<ToolResult> {
    const filePath = this.resolvePath(call.arguments.path as string);
    const offset = call.arguments.offset as number | undefined;
    const limit = call.arguments.limit as number | undefined;

    // H-3: Path containment — resolve symlinks and verify within cwd
    try {
      const realPath = fs.realpathSync(filePath);
      const realCwd = fs.realpathSync(this.opts.cwd);
      if (!isPathWithin(realPath, realCwd)) {
        return {
          callId: call.id,
          output: `Read blocked: ${filePath} is outside the project directory`,
          isError: true,
        };
      }
    } catch {
      // realpathSync fails if file doesn't exist — fall through to existsSync check
    }

    if (!fs.existsSync(filePath)) {
      return { callId: call.id, output: `File not found: ${filePath}`, isError: true };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // List directory contents instead
      const entries = fs.readdirSync(filePath);
      return { callId: call.id, output: `Directory listing:\n${entries.join("\n")}` };
    }

    checkFileSize(stat.size, this.opts.policy);

    let content = fs.readFileSync(filePath, "utf-8");
    if (offset !== undefined || limit !== undefined) {
      const lines = content.split("\n");
      const start = (offset ?? 1) - 1; // Convert 1-based to 0-based
      const end = limit ? start + limit : lines.length;
      content = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}\t${line}`)
        .join("\n");
    }

    return { callId: call.id, output: truncateOutput(content) };
  }

  private async writeFile(call: ToolCall): Promise<ToolResult> {
    const filePath = this.resolvePath(call.arguments.path as string);
    const content = call.arguments.content as string;

    checkWriteAllowed(filePath, this.opts.policy, this.opts.cwd);
    checkFileSize(Buffer.byteLength(content, "utf-8"), this.opts.policy);

    // G-09: Scan for secrets before writing
    if (!this.opts.skipSecretScan) {
      const secrets = scanForSecrets(content);
      const errors = secrets.filter((s) => s.severity === "error");
      const warnings = secrets.filter((s) => s.severity === "warning");
      if (warnings.length > 0) {
        const warnDetails = warnings.map((s) => `  line ${s.line}: ${s.pattern}`).join("\n");
        this.opts.onPolicyWarning?.(`Potential secrets in ${filePath} (warning):\n${warnDetails}`);
      }
      if (errors.length > 0) {
        const details = errors.map((s) => `  line ${s.line}: ${s.pattern}`).join("\n");
        return {
          callId: call.id,
          output: `Blocked write to ${filePath} — potential secrets detected:\n${details}`,
          isError: true,
        };
      }
    }

    this.opts.onBeforeWrite?.(filePath);

    const existed = fs.existsSync(filePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");

    if (existed) {
      this.filesModified.add(filePath);
    } else {
      this.filesWritten.add(filePath);
    }

    let output = `${existed ? "Updated" : "Created"} ${filePath}`;

    // Run skill verification if the file matches a known pattern
    const verifyFeedback = await this.verifyWrittenFile(filePath);
    if (verifyFeedback) {
      output += verifyFeedback;
    }

    return { callId: call.id, output };
  }

  private async editFile(call: ToolCall): Promise<ToolResult> {
    const filePath = this.resolvePath(call.arguments.path as string);
    const oldString = call.arguments.old_string as string;
    const newString = call.arguments.new_string as string;

    if (!fs.existsSync(filePath)) {
      return { callId: call.id, output: `File not found: ${filePath}`, isError: true };
    }

    checkWriteAllowed(filePath, this.opts.policy, this.opts.cwd);
    this.opts.onBeforeWrite?.(filePath);

    const content = fs.readFileSync(filePath, "utf-8");
    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
      return { callId: call.id, output: `old_string not found in ${filePath}`, isError: true };
    }
    if (occurrences > 1) {
      return {
        callId: call.id,
        output: `old_string matched ${occurrences} times in ${filePath} — must be unique. Provide more context.`,
        isError: true,
      };
    }

    const updated = content.replace(oldString, newString);
    checkFileSize(Buffer.byteLength(updated, "utf-8"), this.opts.policy);

    // G-09: Scan for secrets before writing
    if (!this.opts.skipSecretScan) {
      const secrets = scanForSecrets(updated);
      const errors = secrets.filter((s) => s.severity === "error");
      const warnings = secrets.filter((s) => s.severity === "warning");
      if (warnings.length > 0) {
        const warnDetails = warnings.map((s) => `  line ${s.line}: ${s.pattern}`).join("\n");
        this.opts.onPolicyWarning?.(`Potential secrets in ${filePath} (warning):\n${warnDetails}`);
      }
      if (errors.length > 0) {
        const details = errors.map((s) => `  line ${s.line}: ${s.pattern}`).join("\n");
        return {
          callId: call.id,
          output: `Blocked edit to ${filePath} — potential secrets detected:\n${details}`,
          isError: true,
        };
      }
    }

    fs.writeFileSync(filePath, updated, "utf-8");
    this.filesModified.add(filePath);

    return { callId: call.id, output: `Edited ${filePath}` };
  }

  private async runCommand(call: ToolCall): Promise<ToolResult> {
    const command = call.arguments.command as string;
    const cwd = call.arguments.cwd ? this.resolvePath(call.arguments.cwd as string) : this.opts.cwd;
    const timeout = (call.arguments.timeout as number) ?? this.opts.policy.timeoutMs;

    // H-21: cwd containment — prevent executing commands from outside the project
    if (!isPathWithin(path.resolve(cwd), path.resolve(this.opts.cwd))) {
      return {
        callId: call.id,
        output: `Command blocked: cwd "${cwd}" is outside the project directory`,
        isError: true,
      };
    }

    // G-01: Block dangerous command patterns
    const dangerCheck = isDangerousCommand(command);
    if (dangerCheck.dangerous) {
      return {
        callId: call.id,
        output: `Command blocked: ${dangerCheck.reason}`,
        isError: true,
      };
    }

    // G-06: Block network commands when allowNetwork is false
    if (!this.opts.policy.allowNetwork) {
      const blockedNet = findBlockedNetworkCommand(command);
      if (blockedNet) {
        this.opts.onPolicyWarning?.(
          `Network command "${blockedNet}" detected but allowNetwork is false`,
        );
        return {
          callId: call.id,
          output: `Command blocked: network command "${blockedNet}" is not allowed (allowNetwork is false)`,
          isError: true,
        };
      }
    }

    // G-06: Filter env vars when allowEnvVars is set
    let env: Record<string, string> | undefined;
    if (this.opts.policy.allowEnvVars.length > 0) {
      env = {};
      const allowed = new Set([...this.opts.policy.allowEnvVars, ...STANDARD_ENV_VARS]);
      for (const key of allowed) {
        if (process.env[key] !== undefined) {
          env[key] = process.env[key]!;
        }
      }
    }

    try {
      // Parse command into binary + args to avoid shell injection.
      // Simple commands: split on whitespace. Compound commands (pipes, redirects, &&, ||)
      // are blocked since they require shell interpretation and are injection vectors.
      const shellMetachars = /[|;&`$(){}!<>]/;
      if (shellMetachars.test(command)) {
        return {
          callId: call.id,
          output:
            `Command blocked: shell metacharacters are not allowed (|, ;, &, \`, $, etc.). ` +
            `Use simple commands like "terraform validate" or "docker-compose config".`,
          isError: true,
        };
      }

      const args = parseCommandArgs(command);
      const binary = args.shift()!;
      const output = execFileSync(binary, args, {
        cwd,
        encoding: "utf-8",
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES * 2,
        stdio: ["pipe", "pipe", "pipe"],
        ...(env !== undefined ? { env } : {}),
      });
      return { callId: call.id, output: truncateOutput(output) };
    } catch (err) {
      const execErr = err as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
      };
      const rawOutput =
        [execErr.stdout, execErr.stderr].filter(Boolean).join("\n") ||
        execErr.message ||
        "Command failed";

      // Detect "command not found" (exit code 127 or ENOENT) — give the agent a clear, non-retriable error
      if (
        execErr.status === 127 ||
        /command not found|not found in PATH|No such file or directory|ENOENT/i.test(rawOutput)
      ) {
        const bin = command.trim().split(/\s+/)[0];
        return {
          callId: call.id,
          output: [
            `[TOOL NOT INSTALLED] "${bin}" is not available on this system.`,
            `Do NOT retry this command or attempt to install "${bin}".`,
            `Use run_skill for DevOps config generation, or skip this validation step.`,
          ].join("\n"),
          isError: true,
        };
      }

      return { callId: call.id, output: truncateOutput(rawOutput), isError: true };
    }
  }

  /**
   * Resolve a possibly-hallucinated skill name to a valid one.
   * Delegates to the shared `resolveToolName` from @dojops/sdk.
   */
  private resolveSkill(name: string): DevOpsSkill | undefined {
    const skills = this.opts.skills;
    if (!skills) return undefined;
    return resolveToolName(name, skills);
  }

  private async runSkill(call: ToolCall): Promise<ToolResult> {
    const skillName = call.arguments.skill as string;
    const input = call.arguments.input as Record<string, unknown>;

    if (!this.opts.skills) {
      return { callId: call.id, output: "No skills available.", isError: true };
    }

    const skill = this.resolveSkill(skillName);
    if (!skill) {
      const available = [...this.opts.skills.keys()].join(", ");
      return {
        callId: call.id,
        output: `Skill "${skillName}" not found. Available: ${available}`,
        isError: true,
      };
    }

    try {
      const validation = skill.validate(input);
      if (!validation.valid) {
        return {
          callId: call.id,
          output: [
            `ERROR: Validation failed for skill "${skillName}".`,
            ``,
            `The "input" object must contain a "prompt" field (string, required).`,
            `Correct usage: run_skill({ skill: "${skillName}", input: { prompt: "describe what to generate" } })`,
            ``,
            `You provided: ${JSON.stringify(input)}`,
            `Zod error: ${validation.error ?? "unknown"}`,
          ].join("\n"),
          isError: true,
        };
      }

      const maxRetries = this.opts.skillRepairAttempts ?? 1;
      let currentInput = input;
      let result = await skill.generate(currentInput);
      let output = typeof result === "string" ? result : JSON.stringify(result, null, 2);

      // Run skill verification with optional retry loop
      if (skill.verify && !this.opts.policy.skipVerification) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const vResult = await skill.verify(result);
            if (vResult.passed || vResult.issues.length === 0) break;

            const errorIssues = vResult.issues.filter(
              (i) => i.severity === "error" || i.severity === "warning",
            );
            const issueLines = errorIssues
              .slice(0, 5)
              .map((i) => `  - ${i.message ?? i}`)
              .join("\n");

            if (attempt < maxRetries && errorIssues.length > 0) {
              // Retry: inject verification errors as repair context
              currentInput = {
                ...currentInput,
                _repairContext: `Verification failed (attempt ${attempt + 1}/${maxRetries}). Fix these issues:\n${issueLines}`,
              };
              result = await skill.generate(currentInput);
              output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
              continue;
            }

            // Final attempt or only warnings — append issues as advisory
            output += `\n\nVerification (${skill.name}): ${vResult.issues.length} issue(s)\n${issueLines}`;
          } catch {
            // Verification is advisory
            break;
          }
        }
      }

      return { callId: call.id, output: truncateOutput(output) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { callId: call.id, output: `Skill error: ${message}`, isError: true };
    }
  }

  private async searchFiles(call: ToolCall): Promise<ToolResult> {
    const rawPattern = call.arguments.pattern as string | undefined;
    const contentPattern = call.arguments.content_pattern as string | undefined;
    let searchPath = call.arguments.path
      ? this.resolvePath(call.arguments.path as string)
      : this.opts.cwd;

    const validationError = validateSearchPatterns(call.id, rawPattern, contentPattern);
    if (validationError) return validationError;

    // Normalize pattern: extract directory components from patterns like "terraform-iac/**/*.tf"
    let pattern = rawPattern;
    if (pattern?.includes("/")) {
      const normalized = normalizeSearchPattern(pattern, searchPath);
      pattern = normalized.pattern;
      searchPath = normalized.searchPath;
    }

    const results: string[] = [];

    if (pattern) {
      results.push(...searchByFilePattern(pattern, searchPath));
    }

    if (contentPattern) {
      results.push(...searchByContent(contentPattern, searchPath));
    }

    if (results.length === 0) {
      const criteria = [
        pattern && `name "${pattern}"`,
        contentPattern && `content "${contentPattern}"`,
      ]
        .filter(Boolean)
        .join(" and ");
      return { callId: call.id, output: `No files found matching ${criteria} in ${searchPath}.` };
    }

    return { callId: call.id, output: truncateOutput(results.join("\n\n")) };
  }
}
