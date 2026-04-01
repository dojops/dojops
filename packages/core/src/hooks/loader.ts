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
    throw new Error(`${source}: 'hooks' must be an array`);
  }

  const hooks: HookDefinition[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < obj.hooks.length; i++) {
    const h = obj.hooks[i] as Record<string, unknown>;
    const prefix = `${source}: hooks[${i}]`;

    if (!h.id || typeof h.id !== "string") {
      throw new Error(`${prefix}: 'id' is required and must be a string`);
    }

    if (seenIds.has(h.id)) {
      throw new Error(`${prefix}: duplicate hook id '${h.id}'`);
    }
    seenIds.add(h.id);

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

    if (h.type !== "command" && h.type !== "http") {
      throw new Error(`${prefix}: 'type' must be 'command' or 'http'`);
    }

    if (h.type === "command" && (!h.command || typeof h.command !== "string")) {
      throw new Error(`${prefix}: 'command' is required for type 'command'`);
    }

    if (h.type === "http" && (!h.url || typeof h.url !== "string")) {
      throw new Error(`${prefix}: 'url' is required for type 'http'`);
    }

    hooks.push({
      id: h.id,
      name: typeof h.name === "string" ? h.name : undefined,
      events: h.events as HookDefinition["events"],
      type: h.type,
      command: typeof h.command === "string" ? h.command : undefined,
      url: typeof h.url === "string" ? h.url : undefined,
      timeoutMs: typeof h.timeoutMs === "number" ? h.timeoutMs : undefined,
      nonBlocking: typeof h.nonBlocking === "boolean" ? h.nonBlocking : undefined,
      disabled: typeof h.disabled === "boolean" ? h.disabled : undefined,
      cwd: typeof h.cwd === "string" ? h.cwd : undefined,
    });
  }

  return { hooks };
}
