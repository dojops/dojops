import type { DevOpsSkill } from "./skill";

/** Common suffixes LLMs hallucinate onto skill names. */
const STRIP_SUFFIXES = [
  "-chart",
  "-config",
  "-file",
  "-template",
  "-manifest",
  "-setup",
  "-yaml",
  "-yml",
];

/**
 * Resolve a possibly-hallucinated skill name to a valid one.
 * Tries exact match first, then normalization strategies:
 *   1. Strip common suffixes (e.g. "helm-chart" -> "helm")
 *   2. Prefix matching (either direction)
 * Returns undefined if no match is found.
 */
export function resolveToolName(
  name: string,
  available: Map<string, DevOpsSkill>,
): DevOpsSkill | undefined {
  // 1. Exact match
  const exact = available.get(name);
  if (exact) return exact;

  // 2. Strip common suffixes LLMs hallucinate
  for (const suffix of STRIP_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const stripped = name.slice(0, -suffix.length);
      const match = available.get(stripped);
      if (match) return match;
    }
  }

  // 3. Check if any available name starts with or is a prefix of the input
  const lower = name.toLowerCase();
  for (const [key, skill] of available) {
    if (lower.startsWith(key) || key.startsWith(lower)) return skill;
  }

  return undefined;
}
