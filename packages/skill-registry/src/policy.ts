import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export interface SkillPolicy {
  allowedSkills?: string[];
  blockedModules?: string[];
}

/**
 * Loads module policy from .dojops/policy.yaml if present.
 * Returns empty policy (everything allowed) if file is missing.
 * Supports new field names (allowedSkills/blockedModules), previous names (allowedTools/blockedTools),
 * and legacy names (allowedPlugins/blockedPlugins).
 */
export function loadSkillPolicy(projectPath?: string): SkillPolicy {
  if (!projectPath) return {};

  const policyPath = path.join(projectPath, ".dojops", "policy.yaml");
  if (!fs.existsSync(policyPath)) return {};

  try {
    const content = fs.readFileSync(policyPath, "utf-8");
    // SA-03: Limit YAML alias expansion to prevent billion-laughs DoS
    const data = yaml.load(content, { maxAliasCount: 100 } as yaml.LoadOptions) as Record<
      string,
      unknown
    > | null;
    if (!data) return {};

    const policy: SkillPolicy = {};

    // New field names take precedence, fall back to previous, then legacy
    const allowed = data.allowedSkills ?? data.allowedTools ?? data.allowedPlugins;
    if (Array.isArray(allowed)) {
      policy.allowedSkills = allowed.filter((p): p is string => typeof p === "string");
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
 * 2. If allowedSkills is set -> only those names are allowed
 * 3. Otherwise -> allowed (default-open)
 */
export function isSkillAllowed(name: string, policy: SkillPolicy): boolean {
  if (policy.blockedModules?.includes(name)) {
    return false;
  }
  if (policy.allowedSkills && policy.allowedSkills.length > 0) {
    return policy.allowedSkills.includes(name);
  }
  return true;
}
