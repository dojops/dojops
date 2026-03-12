import { GlobalOptions, DEFAULT_GLOBAL_OPTIONS, OutputFormat } from "./types";

export interface ParsedGlobalOptions {
  globalOpts: GlobalOptions;
  remaining: string[];
}

export interface ParsedCommandPath {
  command: string[];
  positional: string[];
}

/** Try to consume a string-valued flag (--flag value or --flag=value). Returns new index if consumed, -1 otherwise. */
function consumeStringFlag(
  args: string[],
  i: number,
  flags: string | string[],
): { value: string; nextIndex: number } | null {
  const arg = args[i];
  const flagList = Array.isArray(flags) ? flags : [flags];

  for (const flag of flagList) {
    if (arg === flag && i + 1 < args.length) {
      return { value: args[i + 1], nextIndex: i + 1 };
    }
    if (arg.startsWith(`${flag}=`)) {
      return { value: arg.slice(flag.length + 1), nextIndex: i };
    }
  }
  return null;
}

/** Parse and validate a temperature value. */
function parseTemperature(raw: string): number {
  const t = Number(raw);
  if (Number.isNaN(t)) throw new Error(`Invalid --temperature value: "${raw}"`);
  if (t < 0 || t > 2) throw new Error(`--temperature must be between 0 and 2, got: ${t}`);
  return t;
}

/** Parse and validate a timeout value. */
function parseTimeout(raw: string): number {
  const t = Number.parseInt(raw, 10);
  if (Number.isNaN(t) || t <= 0)
    throw new Error(
      `Invalid --timeout value: "${raw}". Must be a positive integer (milliseconds).`,
    );
  return t;
}

/** Parse and validate an output format value. */
function parseOutputFormat(raw: string): OutputFormat {
  if (!["table", "json", "yaml"].includes(raw))
    throw new Error(`Invalid --output value: "${raw}". Valid: table, json, yaml`);
  return raw as OutputFormat;
}

/** Parse and validate a thinking level value. */
function parseThinkingLevel(raw: string): "none" | "low" | "medium" | "high" {
  const valid = ["none", "low", "medium", "high"];
  if (!valid.includes(raw))
    throw new Error(`Invalid --thinking value: "${raw}". Valid: ${valid.join(", ")}`);
  return raw as "none" | "low" | "medium" | "high";
}

/** Boolean flags that set a property to true. */
const BOOLEAN_FLAG_MAP: Record<string, keyof GlobalOptions> = {
  "--verbose": "verbose",
  "--debug": "debug",
  "--quiet": "quiet",
  "--no-color": "noColor",
  "--raw": "raw",
  "--non-interactive": "nonInteractive",
  "--dry-run": "dryRun",
};

/**
 * Extracts global options from args, returning the options and remaining args.
 */
export function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  const globalOpts: GlobalOptions = { ...DEFAULT_GLOBAL_OPTIONS };
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Boolean flags
    const boolKey = BOOLEAN_FLAG_MAP[arg];
    if (boolKey) {
      (globalOpts as unknown as Record<string, unknown>)[boolKey] = true;
      continue;
    }

    // End-of-flags separator
    if (arg === "--") continue;

    // String-valued flags
    const consumed = consumeSimpleStringFlag(args, i, globalOpts);
    if (consumed >= 0) {
      i = consumed; // NOSONAR - intentional loop variable update to skip consumed flag value
      continue;
    }

    // Validated flags (temperature, timeout, output)
    const validated = consumeValidatedFlag(args, i, globalOpts);
    if (validated >= 0) {
      i = validated; // NOSONAR - intentional loop variable update to skip consumed flag value
      continue;
    }

    remaining.push(arg);
  }

  return { globalOpts, remaining };
}

/** Handle simple string flags (profile, provider, model, fallback-provider, agent, tool). Returns new index or -1. */
function consumeSimpleStringFlag(args: string[], i: number, opts: GlobalOptions): number {
  const simpleFlags: Array<{ flags: string | string[]; key: keyof GlobalOptions }> = [
    { flags: "--profile", key: "profile" },
    { flags: "--provider", key: "provider" },
    { flags: "--model", key: "model" },
    { flags: "--fallback-provider", key: "fallbackProvider" },
    { flags: "--agent", key: "agent" },
    { flags: ["--module", "--tool"], key: "tool" },
    { flags: ["--file", "-f"], key: "file" },
  ];

  for (const { flags, key } of simpleFlags) {
    const result = consumeStringFlag(args, i, flags);
    if (result) {
      (opts as unknown as Record<string, unknown>)[key] = result.value;
      return result.nextIndex;
    }
  }
  return -1;
}

/** Handle validated flags (temperature, timeout, output). Returns new index or -1. */
function consumeValidatedFlag(args: string[], i: number, opts: GlobalOptions): number {
  const tempResult = consumeStringFlag(args, i, "--temperature");
  if (tempResult) {
    opts.temperature = parseTemperature(tempResult.value);
    return tempResult.nextIndex;
  }

  const timeoutResult = consumeStringFlag(args, i, "--timeout");
  if (timeoutResult) {
    opts.timeout = parseTimeout(timeoutResult.value);
    return timeoutResult.nextIndex;
  }

  const outputResult = consumeStringFlag(args, i, "--output");
  if (outputResult) {
    opts.output = parseOutputFormat(outputResult.value);
    return outputResult.nextIndex;
  }

  const thinkingResult = consumeStringFlag(args, i, "--thinking");
  if (thinkingResult) {
    opts.thinking = parseThinkingLevel(thinkingResult.value);
    return thinkingResult.nextIndex;
  }

  return -1;
}

/**
 * Splits remaining args into command path and positional args.
 * Non-flag args at the start form the command path until we hit something
 * that looks like a prompt or flag.
 */
export function parseCommandPath(args: string[]): ParsedCommandPath {
  const KNOWN_COMMANDS = new Set([
    "plan",
    "generate",
    "apply",
    "validate",
    "explain",
    "debug",
    "analyze",
    "review",
    "inspect",
    "agents",
    "history",
    "config",
    "auth",
    "serve",
    "doctor",
    "status",
    "init",
    "clean",
    "destroy",
    "rollback",
    "modules",
    "tools",
    "toolchain",
    "scan",
    "chat",
    "check",
    "verify",
    "provider",
    "upgrade",
    "help",
    "cron",
    "auto",
    "completion",
    "tokens",
  ]);

  const KNOWN_SUBCOMMANDS = new Set([
    "ci",
    "diff",
    "cost",
    "security",
    "show",
    "list",
    "load",
    "info",
    "login",
    "status",
    "create",
    "use",
    "profile",
    "verify",
    "validate",
    "install",
    "remove",
    "clean",
    "config",
    "policy",
    "agents",
    "session",
    "init",
    "audit",
    "reset",
    "delete",
    "logout",
    "default",
    "add",
    "switch",
    "credentials",
    "repair",
    "publish",
    "search",
    "get",
    "set",
    "export",
    "dev",
    "bash",
    "zsh",
    "fish",
    "alias",
  ]);

  const command: string[] = [];
  let i = 0;

  // First arg must be a known command
  if (i < args.length && KNOWN_COMMANDS.has(args[i])) {
    command.push(args[i]);
    i++;

    // Second arg can be a known subcommand
    if (i < args.length && KNOWN_SUBCOMMANDS.has(args[i]) && !args[i].startsWith("-")) {
      command.push(args[i]);
      i++;
    }
  }

  return { command, positional: args.slice(i) };
}

/**
 * Extracts a flag value from args. Supports --flag=value and --flag value.
 */
export function extractFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      return args[i + 1];
    }
    if (args[i].startsWith(`${flag}=`)) {
      return args[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

/**
 * Checks if a flag is present in args.
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/**
 * Strips flags (and their values) from args, returning only positional args.
 */
export function stripFlags(
  args: string[],
  booleanFlags: Set<string>,
  valueFlags: Set<string>,
): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleanFlags.has(arg)) continue;
    if (valueFlags.has(arg)) {
      i++; // skip value
      continue;
    }
    const eqFlag = arg.split("=")[0];
    if (valueFlags.has(eqFlag)) continue;
    if (arg.startsWith("-")) continue;
    result.push(arg);
  }
  return result;
}
