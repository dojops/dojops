import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface ToolPolicy {
  allowedTools?: string[];
  blockedTools?: string[];
}

/**
 * Loads tool policy from .dojops/policy.yaml if present.
 * Returns empty policy (everything allowed) if file is missing.
 * Supports both new field names (allowedTools/blockedTools) and legacy (allowedPlugins/blockedPlugins).
 */
export function loadToolPolicy(projectPath?: string): ToolPolicy {
  if (!projectPath) return {};

  const policyPath = path.join(projectPath, ".dojops", "policy.yaml");
  if (!fs.existsSync(policyPath)) return {};

  try {
    const content = fs.readFileSync(policyPath, "utf-8");
    const data = yaml.load(content) as Record<string, unknown> | null;
    if (!data) return {};

    const policy: ToolPolicy = {};

    // New field names take precedence, fall back to legacy
    const allowed = data.allowedTools ?? data.allowedPlugins;
    if (Array.isArray(allowed)) {
      policy.allowedTools = allowed.filter((p): p is string => typeof p === "string");
    }

    const blocked = data.blockedTools ?? data.blockedPlugins;
    if (Array.isArray(blocked)) {
      policy.blockedTools = blocked.filter((p): p is string => typeof p === "string");
    }

    return policy;
  } catch {
    return {};
  }
}

/**
 * Checks whether a tool is allowed by the given policy.
 *
 * Rules:
 * 1. If blockedTools is set and includes the name → denied
 * 2. If allowedTools is set → only those names are allowed
 * 3. Otherwise → allowed (default-open)
 */
export function isToolAllowed(name: string, policy: ToolPolicy): boolean {
  if (policy.blockedTools?.includes(name)) {
    return false;
  }
  if (policy.allowedTools && policy.allowedTools.length > 0) {
    return policy.allowedTools.includes(name);
  }
  return true;
}

// Backward compatibility aliases
/** @deprecated Use ToolPolicy instead */
export type PluginPolicy = ToolPolicy;
/** @deprecated Use loadToolPolicy instead */
export const loadPluginPolicy = loadToolPolicy;
/** @deprecated Use isToolAllowed instead */
export const isPluginAllowed = isToolAllowed;
