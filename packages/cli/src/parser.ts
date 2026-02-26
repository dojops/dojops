import { GlobalOptions, DEFAULT_GLOBAL_OPTIONS, OutputFormat } from "./types";

export interface ParsedGlobalOptions {
  globalOpts: GlobalOptions;
  remaining: string[];
}

export interface ParsedCommandPath {
  command: string[];
  positional: string[];
}

/**
 * Extracts global options from args, returning the options and remaining args.
 */
export function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  const globalOpts: GlobalOptions = { ...DEFAULT_GLOBAL_OPTIONS };
  const remaining: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--verbose") {
      globalOpts.verbose = true;
    } else if (arg === "--debug") {
      globalOpts.debug = true;
    } else if (arg === "--quiet") {
      globalOpts.quiet = true;
    } else if (arg === "--no-color") {
      globalOpts.noColor = true;
    } else if (arg === "--non-interactive") {
      globalOpts.nonInteractive = true;
    } else if (arg === "--") {
      // Standard end-of-flags separator (commonly passed by pnpm/npm scripts) — skip it
      continue;
    } else if (arg === "--profile" && i + 1 < args.length) {
      globalOpts.profile = args[++i];
    } else if (arg.startsWith("--profile=")) {
      globalOpts.profile = arg.slice("--profile=".length);
    } else if (arg === "--provider" && i + 1 < args.length) {
      globalOpts.provider = args[++i];
    } else if (arg.startsWith("--provider=")) {
      globalOpts.provider = arg.slice("--provider=".length);
    } else if (arg === "--model" && i + 1 < args.length) {
      globalOpts.model = args[++i];
    } else if (arg.startsWith("--model=")) {
      globalOpts.model = arg.slice("--model=".length);
    } else if (arg === "--temperature" && i + 1 < args.length) {
      const t = Number(args[++i]);
      if (isNaN(t)) throw new Error(`Invalid --temperature value: "${args[i]}"`);
      if (t < 0 || t > 2) throw new Error(`--temperature must be between 0 and 2, got: ${t}`);
      globalOpts.temperature = t;
    } else if (arg.startsWith("--temperature=")) {
      const raw = arg.slice("--temperature=".length);
      const t = Number(raw);
      if (isNaN(t)) throw new Error(`Invalid --temperature value: "${raw}"`);
      if (t < 0 || t > 2) throw new Error(`--temperature must be between 0 and 2, got: ${t}`);
      globalOpts.temperature = t;
    } else if (arg === "--output" && i + 1 < args.length) {
      const fmt = args[++i];
      if (!["table", "json", "yaml"].includes(fmt))
        throw new Error(`Invalid --output value: "${fmt}". Valid: table, json, yaml`);
      globalOpts.output = fmt as OutputFormat;
    } else if (arg.startsWith("--output=")) {
      const fmt = arg.slice("--output=".length);
      if (!["table", "json", "yaml"].includes(fmt))
        throw new Error(`Invalid --output value: "${fmt}". Valid: table, json, yaml`);
      globalOpts.output = fmt as OutputFormat;
    } else {
      remaining.push(arg);
    }
  }

  return { globalOpts, remaining };
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
    "inspect",
    "agents",
    "history",
    "config",
    "auth",
    "serve",
    "doctor",
    "status",
    "init",
    "destroy",
    "rollback",
    "tools",
    "scan",
    "chat",
    "check",
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
    "install",
    "remove",
    "clean",
    "config",
    "policy",
    "agents",
    "session",
    "plugins",
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
