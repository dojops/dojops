import { CommandHandler } from "../types";
import { planCommand } from "./plan";
import { generateCommand } from "./generate";
import { debugCommand } from "./debug";
import { analyzeCommand } from "./analyze";
import { reviewCommand } from "./review";
import { autoCommand } from "./auto";
import { configCommand } from "./config-cmd";
import { authCommand } from "./auth";
import { serveCommand } from "./serve";

export interface ResolvedCommand {
  handler: CommandHandler;
  remaining: string[];
}

type CommandEntry = CommandHandler | Map<string, CommandHandler>;

const registry = new Map<string, CommandEntry>();

// Top-level commands
registry.set("plan", planCommand);
registry.set("generate", generateCommand);
registry.set("review", reviewCommand);
registry.set("auto", autoCommand);
registry.set("config", configCommand);
registry.set("auth", authCommand);
registry.set("serve", serveCommand);

// Nested commands: debug ci
const debugSubs = new Map<string, CommandHandler>();
debugSubs.set("ci", debugCommand);
registry.set("debug", debugSubs);

// Nested commands: analyze diff
const analyzeSubs = new Map<string, CommandHandler>();
analyzeSubs.set("diff", analyzeCommand);
registry.set("analyze", analyzeSubs);

/**
 * Resolves a command path to a handler.
 * Returns null if no command matches (fall back to generate).
 */
export function resolveCommand(commandPath: string[], remaining: string[]): ResolvedCommand | null {
  if (commandPath.length === 0) return null;

  const entry = registry.get(commandPath[0]);
  if (!entry) return null;

  // Simple command handler
  if (typeof entry === "function") {
    return { handler: entry, remaining: [...commandPath.slice(1), ...remaining] };
  }

  // Nested command map
  if (commandPath.length >= 2) {
    const sub = entry.get(commandPath[1]);
    if (sub) {
      return { handler: sub, remaining: [...commandPath.slice(2), ...remaining] };
    }
  }

  // No matching subcommand found — return null so the caller can show a proper error
  return null;
}

/**
 * Registers a command handler dynamically (used by later phases).
 */
export function registerCommand(path: string, handler: CommandHandler): void {
  registry.set(path, handler);
}

/**
 * Registers a nested subcommand dynamically.
 */
export function registerSubcommand(parent: string, sub: string, handler: CommandHandler): void {
  let entry = registry.get(parent);
  if (!entry || typeof entry === "function") {
    entry = new Map<string, CommandHandler>();
    registry.set(parent, entry);
  }
  (entry as Map<string, CommandHandler>).set(sub, handler);
}
