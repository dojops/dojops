import type { DevOpsSkill } from "@dojops/sdk";

// ── Types ────────────────────────────────────────────────────────────

export interface SkillScore {
  skill: DevOpsSkill;
  score: number;
  matchedTerms: string[];
}

export interface DeferredLoaderOptions {
  /** Max skills to inject into the system prompt (default: 5). */
  topK?: number;
  /** Working directory for scope.paths matching. */
  cwd?: string;
}

// ── Keyword extraction ──────────────────────────────────────────────

/**
 * Extract searchable keywords from a skill.
 * Uses the runtime `keywords` getter if available, otherwise tokenizes name + description.
 */
function extractKeywords(skill: DevOpsSkill): string[] {
  // DopsRuntimeV2 exposes a keywords getter
  const asAny = skill as unknown as Record<string, unknown>;
  if (Array.isArray(asAny.keywords) && asAny.keywords.length > 0) {
    return (asAny.keywords as string[]).map((k) => k.toLowerCase());
  }

  // Fallback: tokenize name + description
  const text = `${skill.name} ${skill.description}`;
  return text
    .toLowerCase()
    .split(/[\s,\-_./]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Extract tags from a skill's frontmatter if available.
 */
function extractTags(skill: DevOpsSkill): string[] {
  const asAny = skill as unknown as Record<string, unknown>;
  // DopsRuntimeV2 stores the DopsSkill in a private `skill` field,
  // but tags are accessible via the frontmatter chain
  if (
    asAny.skill &&
    typeof asAny.skill === "object" &&
    (asAny.skill as Record<string, unknown>).frontmatter
  ) {
    const fm = (asAny.skill as Record<string, unknown>).frontmatter as Record<string, unknown>;
    const meta = fm.meta as Record<string, unknown> | undefined;
    if (meta?.tags && Array.isArray(meta.tags)) {
      return (meta.tags as string[]).map((t) => t.toLowerCase());
    }
  }
  return [];
}

/**
 * Extract scope write patterns from a skill's frontmatter if available.
 */
function extractScopePatterns(skill: DevOpsSkill): string[] {
  const asAny = skill as unknown as Record<string, unknown>;
  if (
    asAny.skill &&
    typeof asAny.skill === "object" &&
    (asAny.skill as Record<string, unknown>).frontmatter
  ) {
    const fm = (asAny.skill as Record<string, unknown>).frontmatter as Record<string, unknown>;
    const scope = fm.scope as { write?: string[] } | undefined;
    if (scope?.write && Array.isArray(scope.write)) {
      return scope.write;
    }
  }
  return [];
}

// ── Scoring ─────────────────────────────────────────────────────────

/**
 * Score a skill against a query using keyword overlap.
 * Returns a normalized score (0-1) and the list of matched terms.
 */
function scoreSkill(skill: DevOpsSkill, queryTerms: string[]): SkillScore {
  const keywords = extractKeywords(skill);
  const tags = extractTags(skill);
  const allTerms = new Set([...keywords, ...tags]);
  const matchedTerms: string[] = [];

  for (const qt of queryTerms) {
    // Exact match in keywords/tags
    if (allTerms.has(qt)) {
      matchedTerms.push(qt);
      continue;
    }
    // Partial match: query term is a substring of a keyword or vice versa
    for (const kw of allTerms) {
      if (kw.includes(qt) || qt.includes(kw)) {
        matchedTerms.push(qt);
        break;
      }
    }
  }

  // Also check name and description for direct matches
  const nameLower = skill.name.toLowerCase();
  const descLower = skill.description.toLowerCase();
  for (const qt of queryTerms) {
    if (!matchedTerms.includes(qt)) {
      if (nameLower.includes(qt) || descLower.includes(qt)) {
        matchedTerms.push(qt);
      }
    }
  }

  // Deduplicate
  const unique = [...new Set(matchedTerms)];

  // Score: ratio of matched query terms, with a bonus for name-exact match
  let score = queryTerms.length > 0 ? unique.length / queryTerms.length : 0;
  if (queryTerms.some((qt) => qt === nameLower)) {
    score = Math.min(1, score + 0.3); // name-exact match bonus
  }

  return { skill, score, matchedTerms: unique };
}

// ── Tokenizer ──────────────────────────────────────────────────────

/** Tokenize a user query into lowercase search terms. */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,\-_./]+/)
    .filter((t) => t.length >= 2);
}

// ── DeferredSkillLoader ─────────────────────────────────────────────

/**
 * Deferred skill loader: ranks skills by relevance to a query
 * and returns only the top-K most relevant ones.
 *
 * This reduces token usage by not injecting all 38+ skill descriptions
 * into every system prompt. The agent can call `search_skills` to
 * discover additional skills on demand.
 */
export class DeferredSkillLoader {
  private readonly skills: DevOpsSkill[];
  private readonly topK: number;

  constructor(skills: DevOpsSkill[], options?: DeferredLoaderOptions) {
    this.skills = skills;
    this.topK = options?.topK ?? 5;
  }

  /**
   * Get the top-K skills most relevant to the user's prompt.
   * Falls back to the first K skills by registration order if no query.
   */
  getRelevantSkills(query: string): SkillScore[] {
    if (!query.trim()) {
      return this.skills.slice(0, this.topK).map((s) => ({
        skill: s,
        score: 0,
        matchedTerms: [],
      }));
    }

    const terms = tokenizeQuery(query);
    const scored = this.skills
      .map((s) => scoreSkill(s, terms))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, this.topK);
  }

  /**
   * Search all skills by query. Returns all matches sorted by relevance.
   * Used by the `search_skills` tool at runtime.
   */
  searchSkills(query: string): SkillScore[] {
    if (!query.trim()) {
      return this.skills.map((s) => ({ skill: s, score: 0, matchedTerms: [] }));
    }

    const terms = tokenizeQuery(query);
    return this.skills
      .map((s) => scoreSkill(s, terms))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Build a compact skill catalog string for the system prompt.
   * Lists all skills by name + one-line description so the agent
   * knows what's available without full injection.
   */
  buildCatalog(): string {
    const lines = this.skills.map((s) => `- ${s.name}: ${s.description}`);
    return lines.join("\n");
  }

  /** Total number of registered skills. */
  get size(): number {
    return this.skills.length;
  }
}

// ── Standalone utilities ────────────────────────────────────────────

export { tokenizeQuery, scoreSkill, extractKeywords, extractTags, extractScopePatterns };
