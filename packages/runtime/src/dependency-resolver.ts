import type { SkillDependency } from "./spec";

export interface SkillLookup {
  has(name: string): boolean;
}

export interface DependencyResult {
  /** Skills in execution order (dependencies first). */
  order: string[];
  /** Missing required dependencies. */
  missing: string[];
  /** Missing optional dependencies (informational). */
  missingOptional: string[];
}

/**
 * Resolve skill dependencies into execution order.
 * Returns skills sorted topologically (deps before dependents).
 * Detects circular dependencies.
 */
export function resolveSkillDependencies(
  skillName: string,
  dependencies: SkillDependency[],
  registry: SkillLookup,
): DependencyResult {
  const missing: string[] = [];
  const missingOptional: string[] = [];
  const order: string[] = [];

  for (const dep of dependencies) {
    if (registry.has(dep.skill)) {
      order.push(dep.skill);
    } else if (dep.optional) {
      missingOptional.push(dep.skill);
    } else {
      missing.push(dep.skill);
    }
  }

  // Add the skill itself last
  order.push(skillName);

  return { order, missing, missingOptional };
}
