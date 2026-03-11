import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export interface ModulePolicy {
  allowedModules?: string[];
  blockedModules?: string[];
}

/**
 * Loads module policy from .dojops/policy.yaml if present.
 * Returns empty policy (everything allowed) if file is missing.
 * Supports new field names (allowedModules/blockedModules), previous names (allowedTools/blockedTools),
 * and legacy names (allowedPlugins/blockedPlugins).
 */
export function loadModulePolicy(projectPath?: string): ModulePolicy {
  if (!projectPath) return {};

  const policyPath = path.join(projectPath, ".dojops", "policy.yaml");
  if (!fs.existsSync(policyPath)) return {};

  try {
    const content = fs.readFileSync(policyPath, "utf-8");
    const data = yaml.load(content) as Record<string, unknown> | null;
    if (!data) return {};

    const policy: ModulePolicy = {};

    // New field names take precedence, fall back to previous, then legacy
    const allowed = data.allowedModules ?? data.allowedTools ?? data.allowedPlugins;
    if (Array.isArray(allowed)) {
      policy.allowedModules = allowed.filter((p): p is string => typeof p === "string");
    }

    const blocked = data.blockedModules ?? data.blockedTools ?? data.blockedPlugins;
    if (Array.isArray(blocked)) {
      policy.blockedModules = blocked.filter((p): p is string => typeof p === "string");
    }

    return policy;
  } catch {
    return {};
  }
}

/**
 * Checks whether a module is allowed by the given policy.
 *
 * Rules:
 * 1. If blockedModules is set and includes the name -> denied
 * 2. If allowedModules is set -> only those names are allowed
 * 3. Otherwise -> allowed (default-open)
 */
export function isModuleAllowed(name: string, policy: ModulePolicy): boolean {
  if (policy.blockedModules?.includes(name)) {
    return false;
  }
  if (policy.allowedModules && policy.allowedModules.length > 0) {
    return policy.allowedModules.includes(name);
  }
  return true;
}
