/**
 * Lifecycle hook system for DojOps CLI.
 *
 * Hooks are shell commands configured in .dojops/hooks.json that run
 * at specific lifecycle events (pre-generate, post-generate, etc.).
 *
 * Hook context is passed via environment variables prefixed with DOJOPS_HOOK_.
 */

import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { runShellCmd } from "./safe-exec";
import { isFolderTrusted } from "./trust";

export type HookEvent =
  | "pre-generate"
  | "post-generate"
  | "pre-plan"
  | "post-plan"
  | "pre-execute"
  | "post-execute"
  | "pre-scan"
  | "post-scan"
  | "on-error";

export interface HookDefinition {
  /** Shell command to execute */
  command: string;
  /** Optional description for display */
  description?: string;
  /** Continue on hook failure (default: false for pre-hooks, true for post-hooks) */
  continueOnError?: boolean;
}

export interface HooksConfig {
  hooks?: Partial<Record<HookEvent, HookDefinition | HookDefinition[]>>;
}

export interface HookContext {
  event: HookEvent;
  /** Project root directory */
  rootDir: string;
  /** Agent name (if applicable) */
  agent?: string;
  /** Output file path (if applicable) */
  outputPath?: string;
  /** The user prompt (if applicable) */
  prompt?: string;
  /** Error message (for on-error hooks) */
  error?: string;
}

/**
 * Load hooks configuration from .dojops/hooks.json.
 * Returns empty config if file doesn't exist or is invalid.
 */
export function loadHooksConfig(rootDir: string): HooksConfig {
  const hooksPath = path.join(rootDir, ".dojops", "hooks.json");
  try {
    const raw = fs.readFileSync(hooksPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as HooksConfig;
  } catch {
    return {};
  }
}

/**
 * Env var names that must NEVER be forwarded to hooks.
 * These contain LLM API tokens and the DojOps API key.
 */
const HOOK_BLOCKED_ENV_VARS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "GEMINI_API_KEY",
  "GITHUB_COPILOT_TOKEN",
  "DOJOPS_API_KEY",
  "DOJOPS_HUB_TOKEN",
  "DOJOPS_VAULT_KEY",
  "DOJOPS_CONTEXT7_API_KEY",
]);

/**
 * Build environment variables for hook execution.
 * Sensitive API keys and tokens are stripped so hook commands cannot exfiltrate them.
 */
function buildHookEnv(ctx: HookContext): Record<string, string> {
  // Copy the current environment minus any blocked (sensitive) keys.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !HOOK_BLOCKED_ENV_VARS.has(k)) {
      env[k] = v;
    }
  }
  env.DOJOPS_HOOK_EVENT = ctx.event;
  env.DOJOPS_HOOK_ROOT = ctx.rootDir;
  if (ctx.agent) env.DOJOPS_HOOK_AGENT = ctx.agent;
  if (ctx.outputPath) env.DOJOPS_HOOK_OUTPUT = ctx.outputPath;
  if (ctx.prompt) env.DOJOPS_HOOK_PROMPT = ctx.prompt;
  if (ctx.error) env.DOJOPS_HOOK_ERROR = ctx.error;
  return env;
}

/** Block hook commands that pipe from network or use eval-like constructs. */
const DANGEROUS_HOOK_PATTERNS = [
  // Remote code download piped to a shell
  /\bcurl\b.*\|\s*(bash|sh|zsh|python[23]?|node|perl|ruby)/i,
  /\bwget\b.*\|\s*(bash|sh|zsh|python[23]?|node|perl|ruby)/i,
  // Command substitution / subshell execution
  /\beval\s/,
  /\$\(curl\b/i,
  /\$\(wget\b/i,
  /\$\([^)]+\)/, // generic $() command substitution
  /`[^`]+`/, // backtick subshell
  // Interpreter inline execution flags (-c / -e)
  /\bpython[23]?\s+-c\b/i,
  /\bnode\s+-e\b/i,
  /\bperl\s+-e\b/i,
  /\bruby\s+-e\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
  /\bzsh\s+-c\b/i,
  // Chained-command injection (hook command itself should be a single command)
  /\|\s*(bash|sh|zsh|python[23]?|node|perl|ruby)\b/,
  // PowerShell code execution
  /Invoke-Expression|IEX\b|\bpowershell\b.*-Command|\bpwsh\b.*-Command/i,
  // Encoded command execution
  /base64.*\|\s*(bash|sh)/i,
  /\benv\s+(bash|sh|zsh|python[23]?|node|perl|ruby)\b/i,
];

/**
 * Execute a single hook command.
 * Returns true if successful, false if failed.
 */
function executeHook(hook: HookDefinition, ctx: HookContext, verbose: boolean): boolean {
  // Block known-dangerous command patterns
  if (DANGEROUS_HOOK_PATTERNS.some((pat) => pat.test(hook.command))) {
    p.log.warn(`Hook ${pc.yellow(ctx.event)} blocked: command contains a dangerous pattern.`);
    return false;
  }

  const env = buildHookEnv(ctx);
  try {
    if (verbose) {
      p.log.info(pc.dim(`[hook:${ctx.event}] ${hook.command}`));
    }
    runShellCmd(hook.command, {
      cwd: ctx.rootDir,
      env,
      timeout: 30_000,
      stdio: verbose ? "inherit" : "pipe",
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.warn(`Hook ${pc.yellow(ctx.event)} failed: ${pc.dim(msg)}`);
    return false;
  }
}

/**
 * Run all hooks for a given lifecycle event.
 *
 * For pre-* hooks: aborts on failure (unless continueOnError is set).
 * For post-* and on-error hooks: continues on failure by default.
 *
 * Returns true if all hooks passed (or were allowed to fail).
 */
export function runHooks(
  rootDir: string,
  event: HookEvent,
  context: Omit<HookContext, "event" | "rootDir">,
  options?: { verbose?: boolean },
): boolean {
  const config = loadHooksConfig(rootDir);
  if (!config.hooks) return true;

  const hookDefs = config.hooks[event];
  if (!hookDefs) return true;

  // Hooks execute arbitrary shell commands — require workspace trust
  const trustCheck = isFolderTrusted(rootDir);
  if (!trustCheck.trusted) {
    p.log.warn(
      `Hooks skipped (${event}): workspace not trusted. Run ${pc.cyan("dojops trust")} first.`,
    );
    return true;
  }

  const hooks = Array.isArray(hookDefs) ? hookDefs : [hookDefs];
  const isPreHook = event.startsWith("pre-");
  const verbose = options?.verbose ?? false;

  for (const hook of hooks) {
    const allowFail = hook.continueOnError ?? !isPreHook;
    const ok = executeHook(hook, { ...context, event, rootDir }, verbose);
    if (!ok && !allowFail) {
      p.log.error(`Pre-hook ${pc.red(event)} failed — aborting.`);
      return false;
    }
  }

  return true;
}
