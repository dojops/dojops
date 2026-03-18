import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { ExecutionPolicy } from "./types";
import { checkWriteAllowed, checkFileSize } from "./policy";
import type { ToolCall, ToolResult, ToolDefinition } from "@dojops/core";
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

export interface ToolExecutorOptions {
  policy: ExecutionPolicy;
  cwd: string;
  skills?: Map<string, DevOpsSkill>;
  mcpDispatcher?: McpToolDispatcher;
  onToolStart?: (call: ToolCall) => void;
  onToolEnd?: (call: ToolCall, result: ToolResult) => void;
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

/** Search for files by name pattern using find. Falls back to -path for glob patterns. */
function searchByFilePattern(pattern: string, searchPath: string): string[] {
  try {
    const output = execFileSync(
      "/bin/sh",
      [
        "-c",
        `find ${JSON.stringify(searchPath)} -type f -name ${JSON.stringify(pattern)} 2>/dev/null | head -50`,
      ],
      { encoding: "utf-8", timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES },
    );
    if (output.trim()) return [`Files matching "${pattern}":\n${output.trim()}`];
    return [];
  } catch {
    return searchByPathPattern(pattern, searchPath);
  }
}

/** Fallback file search using -path for glob/wildcard patterns. */
function searchByPathPattern(pattern: string, searchPath: string): string[] {
  try {
    const output = execFileSync(
      "/bin/sh",
      [
        "-c",
        `find ${JSON.stringify(searchPath)} -type f -path ${JSON.stringify(pattern)} 2>/dev/null | head -50`,
      ],
      { encoding: "utf-8", timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES },
    );
    if (output.trim()) return [`Files matching "${pattern}":\n${output.trim()}`];
    return [];
  } catch {
    return [`No files found matching "${pattern}"`];
  }
}

/** Search for files containing a given content pattern using grep. */
function searchByContent(contentPattern: string, searchPath: string): string[] {
  try {
    const output = execFileSync(
      "/bin/sh",
      [
        "-c",
        `grep -rl ${JSON.stringify(contentPattern)} ${JSON.stringify(searchPath)} 2>/dev/null | head -30`,
      ],
      { encoding: "utf-8", timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES },
    );
    if (output.trim()) {
      return [`Files containing "${contentPattern}":\n${output.trim()}`];
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

  private async readFile(call: ToolCall): Promise<ToolResult> {
    const filePath = this.resolvePath(call.arguments.path as string);
    const offset = call.arguments.offset as number | undefined;
    const limit = call.arguments.limit as number | undefined;

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

    checkWriteAllowed(filePath, this.opts.policy);
    checkFileSize(Buffer.byteLength(content, "utf-8"), this.opts.policy);

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

    return { callId: call.id, output: `${existed ? "Updated" : "Created"} ${filePath}` };
  }

  private async editFile(call: ToolCall): Promise<ToolResult> {
    const filePath = this.resolvePath(call.arguments.path as string);
    const oldString = call.arguments.old_string as string;
    const newString = call.arguments.new_string as string;

    if (!fs.existsSync(filePath)) {
      return { callId: call.id, output: `File not found: ${filePath}`, isError: true };
    }

    checkWriteAllowed(filePath, this.opts.policy);

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
    fs.writeFileSync(filePath, updated, "utf-8");
    this.filesModified.add(filePath);

    return { callId: call.id, output: `Edited ${filePath}` };
  }

  private async runCommand(call: ToolCall): Promise<ToolResult> {
    const command = call.arguments.command as string;
    const cwd = call.arguments.cwd ? this.resolvePath(call.arguments.cwd as string) : this.opts.cwd;
    const timeout = (call.arguments.timeout as number) ?? this.opts.policy.timeoutMs;

    try {
      // Use execFileSync with shell to execute the command safely
      const output = execFileSync("/bin/sh", ["-c", command], {
        cwd,
        encoding: "utf-8",
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES * 2,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { callId: call.id, output: truncateOutput(output) };
    } catch (err) {
      const execErr = err as {
        stdout?: string;
        stderr?: string;
        status?: number;
        message?: string;
      };
      const output =
        [execErr.stdout, execErr.stderr].filter(Boolean).join("\n") ||
        execErr.message ||
        "Command failed";
      return { callId: call.id, output: truncateOutput(output), isError: true };
    }
  }

  /**
   * Resolve a possibly-hallucinated skill name to a valid one.
   * Tries exact match, then strips common LLM-hallucinated suffixes.
   */
  private resolveSkill(name: string): DevOpsSkill | undefined {
    const skills = this.opts.skills;
    if (!skills) return undefined;

    // Exact match
    const exact = skills.get(name);
    if (exact) return exact;

    // Strip common suffixes (e.g. "helm-chart" → "helm")
    const suffixes = [
      "-chart",
      "-config",
      "-file",
      "-template",
      "-manifest",
      "-setup",
      "-yaml",
      "-yml",
    ];
    for (const suffix of suffixes) {
      if (name.endsWith(suffix)) {
        const match = skills.get(name.slice(0, -suffix.length));
        if (match) return match;
      }
    }

    // Prefix matching
    const lower = name.toLowerCase();
    for (const [key, skill] of skills) {
      if (lower.startsWith(key) || key.startsWith(lower)) return skill;
    }

    return undefined;
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
          output: `Validation failed: ${validation.error ?? "unknown error"}`,
          isError: true,
        };
      }

      const result = await skill.generate(input);
      const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
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

    // No criteria provided at all
    if (!rawPattern && !contentPattern) {
      return {
        callId: call.id,
        output:
          "No search criteria provided. Use 'pattern' for file name matching and/or 'content_pattern' for content search.",
        isError: true,
      };
    }

    // Normalize pattern: extract directory components from patterns like "terraform-iac/**/*.tf"
    let pattern = rawPattern;
    if (pattern && pattern.includes("/")) {
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
