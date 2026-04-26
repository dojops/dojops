import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HookConfig, HookDefinition } from "./types";
import { HOOK_EVENTS } from "./types";

/**
 * Load hook configuration from a .dojops/hooks.json file.
 * Returns an empty config if the file doesn't exist.
 * Throws on invalid JSON or schema violations.
 */
export function loadHookConfig(projectDir: string): HookConfig {
  const configPath = join(projectDir, ".dojops", "hooks.json");

  if (!existsSync(configPath)) {
    return { hooks: [] };
  }

  const raw = readFileSync(configPath, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  return validateHookConfig(parsed, configPath);
}

/** Validate a parsed hook config object. */
function validateHookConfig(raw: unknown, source: string): HookConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${source}: expected an object`);
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.hooks)) {
    throw new TypeError(`${source}: 'hooks' must be an array`);
  }

  const seenIds = new Set<string>();
  const hooks: HookDefinition[] = obj.hooks.map((entry, i) => {
    const prefix = `${source}: hooks[${i}]`;
    const h = entry as Record<string, unknown>;
    validateHookId(h, prefix, seenIds);
    validateHookEvents(h, prefix);
    validateHookType(h, prefix);
    return buildHookDefinition(h);
  });

  return { hooks };
}

/** Validate the hook id is present, is a string, and is unique. */
function validateHookId(h: Record<string, unknown>, prefix: string, seenIds: Set<string>): void {
  if (!h.id || typeof h.id !== "string") {
    throw new Error(`${prefix}: 'id' is required and must be a string`);
  }
  if (seenIds.has(h.id)) {
    throw new Error(`${prefix}: duplicate hook id '${h.id}'`);
  }
  seenIds.add(h.id);
}

/** Validate the events array contains only known event names. */
function validateHookEvents(h: Record<string, unknown>, prefix: string): void {
  if (!Array.isArray(h.events) || h.events.length === 0) {
    throw new Error(`${prefix}: 'events' must be a non-empty array`);
  }
  for (const event of h.events) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event as string)) {
      throw new Error(
        `${prefix}: unknown event '${event}'. Valid events: ${HOOK_EVENTS.join(", ")}`,
      );
    }
  }
}

/** Validate the hook type and its type-specific required fields. */
function validateHookType(h: Record<string, unknown>, prefix: string): void {
  if (h.type !== "command" && h.type !== "http") {
    throw new Error(`${prefix}: 'type' must be 'command' or 'http'`);
  }
  if (h.type === "command" && (!h.command || typeof h.command !== "string")) {
    throw new Error(`${prefix}: 'command' is required for type 'command'`);
  }
  if (h.type === "http" && (!h.url || typeof h.url !== "string")) {
    throw new Error(`${prefix}: 'url' is required for type 'http'`);
  }
}

/** Build a HookDefinition from a validated raw object. */
function buildHookDefinition(h: Record<string, unknown>): HookDefinition {
  return {
    id: h.id as string,
    name: typeof h.name === "string" ? h.name : undefined,
    events: h.events as HookDefinition["events"],
    type: h.type as HookDefinition["type"],
    command: typeof h.command === "string" ? h.command : undefined,
    url: typeof h.url === "string" ? h.url : undefined,
    timeoutMs: typeof h.timeoutMs === "number" ? h.timeoutMs : undefined,
    nonBlocking: typeof h.nonBlocking === "boolean" ? h.nonBlocking : undefined,
    disabled: typeof h.disabled === "boolean" ? h.disabled : undefined,
    cwd: typeof h.cwd === "string" ? h.cwd : undefined,
  };
}
