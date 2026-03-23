/**
 * Tiered model routing across all LLM providers.
 *
 * Picks the cheapest model capable of handling each task by classifying
 * prompt complexity and mapping it to provider-specific model tiers.
 * No LLM calls — classification is pure heuristics.
 */

export interface ModelTier {
  fast: string;
  standard: string;
  premium: string;
}

export type TierName = "fast" | "standard" | "premium";

export type TaskComplexity = "simple" | "moderate" | "complex";

export const PROVIDER_MODEL_TIERS: Record<string, ModelTier> = {
  openai: { fast: "gpt-4o-mini", standard: "gpt-4o", premium: "o1" },
  anthropic: {
    fast: "claude-haiku-4-5-20251001",
    standard: "claude-sonnet-4-6",
    premium: "claude-opus-4-6",
  },
  ollama: { fast: "llama3.2:3b", standard: "llama3.1:8b", premium: "llama3.1:70b" },
  deepseek: { fast: "deepseek-chat", standard: "deepseek-chat", premium: "deepseek-reasoner" },
  mistral: {
    fast: "mistral-small-latest",
    standard: "mistral-medium-latest",
    premium: "mistral-large-latest",
  },
  gemini: { fast: "gemini-2.0-flash", standard: "gemini-2.5-pro", premium: "gemini-2.5-pro" },
  "github-copilot": { fast: "gpt-4o-mini", standard: "gpt-4o", premium: "o1" },
};

/** Estimated cost per 1M tokens for each provider tier. */
export const PROVIDER_COST_PER_M_TOKENS: Record<
  string,
  Record<TierName, { input: number; output: number }>
> = {
  openai: {
    fast: { input: 0.15, output: 0.6 },
    standard: { input: 2.5, output: 10.0 },
    premium: { input: 15.0, output: 60.0 },
  },
  anthropic: {
    fast: { input: 0.8, output: 4.0 },
    standard: { input: 3.0, output: 15.0 },
    premium: { input: 15.0, output: 75.0 },
  },
  ollama: {
    fast: { input: 0, output: 0 },
    standard: { input: 0, output: 0 },
    premium: { input: 0, output: 0 },
  },
  deepseek: {
    fast: { input: 0.27, output: 1.1 },
    standard: { input: 0.27, output: 1.1 },
    premium: { input: 2.19, output: 8.76 },
  },
  mistral: {
    fast: { input: 0.1, output: 0.3 },
    standard: { input: 2.7, output: 8.1 },
    premium: { input: 3.0, output: 9.0 },
  },
  gemini: {
    fast: { input: 0.1, output: 0.4 },
    standard: { input: 1.25, output: 10.0 },
    premium: { input: 1.25, output: 10.0 },
  },
  "github-copilot": {
    fast: { input: 0, output: 0 },
    standard: { input: 0, output: 0 },
    premium: { input: 0, output: 0 },
  },
};

// Skills that produce simple, single-file output
const SIMPLE_SKILLS = new Set([
  "makefile",
  "systemd",
  "nginx",
  "dockerfile",
  "docker-compose",
  "prometheus",
]);

// Keywords that signal architectural or multi-system complexity
const COMPLEX_KEYWORDS =
  /\b(architect|design|migrate|multi[- ]?cloud|disaster[- ]?recovery|zero[- ]?downtime|blue[- ]?green|canary|microservice|distributed|fault[- ]?toleran|high[- ]?availability|cross[- ]?region|federation|mesh|orchestrat)\b/i;

// Multi-skill references like "terraform and kubernetes and helm"
const MULTI_SKILL_REF =
  /\b(terraform|kubernetes|k8s|helm|ansible|jenkins|gitlab[- ]?ci|github[- ]?actions)\b/gi;

/**
 * Classify task complexity from the prompt text.
 * Pure heuristics — no LLM call.
 */
export function classifyTaskComplexity(prompt: string, skillName?: string): TaskComplexity {
  const words = prompt.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Skill-based fast path
  if (skillName && SIMPLE_SKILLS.has(skillName.toLowerCase())) {
    // Even a simple skill becomes complex with architecture keywords
    if (COMPLEX_KEYWORDS.test(prompt)) return "complex";
    return "simple";
  }

  // Very short prompts are simple
  if (wordCount < 100 && !COMPLEX_KEYWORDS.test(prompt)) {
    // Check for multi-skill references that push short prompts to moderate
    const skillMatches = prompt.match(MULTI_SKILL_REF);
    const uniqueSkills = skillMatches ? new Set(skillMatches.map((s) => s.toLowerCase())).size : 0;
    if (uniqueSkills >= 2) return "moderate";
    return "simple";
  }

  // Architecture/design keywords push to complex
  if (COMPLEX_KEYWORDS.test(prompt)) return "complex";

  // Long prompts (>500 words) are complex
  if (wordCount > 500) return "complex";

  // Multi-skill references (3+) are complex
  const skillMatches = prompt.match(MULTI_SKILL_REF);
  const uniqueSkills = skillMatches ? new Set(skillMatches.map((s) => s.toLowerCase())).size : 0;
  if (uniqueSkills >= 3) return "complex";

  return "moderate";
}

/**
 * Select the tier based on task complexity and call context.
 * Routing calls (AgentRouter decisions) always use the fast tier.
 */
export function selectModelTier(
  complexity: TaskComplexity,
  isStructuredOutput: boolean,
  isRouting: boolean,
): TierName {
  // Routing decisions are cheap classification tasks
  if (isRouting) return "fast";

  switch (complexity) {
    case "simple":
      return "fast";
    case "moderate":
      // Structured output stays standard — schema adherence needs capability
      return "standard";
    case "complex":
      return "premium";
  }
}

/**
 * Get the model name for a provider and tier.
 * `DOJOPS_MODEL` env var overrides the tier-based selection.
 */
export function getModelForTier(providerName: string, tier: TierName): string {
  const override = process.env.DOJOPS_MODEL;
  if (override) return override;

  const tiers = PROVIDER_MODEL_TIERS[providerName];
  if (!tiers) {
    throw new Error(`Unknown provider "${providerName}" — no model tiers defined`);
  }
  return tiers[tier];
}

export interface ModelRouteResult {
  model: string;
  tier: TierName;
  complexity: TaskComplexity;
}

/**
 * Full routing pipeline: classify prompt complexity, select tier, resolve model.
 * Returns the model name, selected tier, and detected complexity.
 */
export function routeModel(
  providerName: string,
  prompt: string,
  opts?: { skillName?: string; isStructuredOutput?: boolean; isRouting?: boolean },
): ModelRouteResult {
  const skillName = opts?.skillName;
  const isStructuredOutput = opts?.isStructuredOutput ?? false;
  const isRouting = opts?.isRouting ?? false;

  const complexity = classifyTaskComplexity(prompt, skillName);
  const tier = selectModelTier(complexity, isStructuredOutput, isRouting);
  const model = getModelForTier(providerName, tier);

  return { model, tier, complexity };
}

/**
 * Estimate the cost for a given number of tokens on a provider tier.
 * Returns cost in USD. Returns 0 for unknown providers.
 */
export function estimateCost(
  providerName: string,
  tier: TierName,
  inputTokens: number,
  outputTokens: number,
): number {
  const costs = PROVIDER_COST_PER_M_TOKENS[providerName];
  if (!costs) return 0;
  const tierCost = costs[tier];
  return (inputTokens / 1_000_000) * tierCost.input + (outputTokens / 1_000_000) * tierCost.output;
}
