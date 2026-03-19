export interface ModelRoutingRule {
  match: "simple" | "complex" | "code" | "review" | "analysis";
  model: string;
  /** Optional: override provider too. */
  provider?: string;
}

export interface ModelRoutingConfig {
  enabled: boolean;
  rules: ModelRoutingRule[];
}

export interface PromptComplexity {
  level: "simple" | "moderate" | "complex";
  score: number;
  reason: string;
}

const SIMPLE_STARTERS = /^(what|who|where|when|how|why|is|are|can|does|do|will|should)\b/i;
const SIMPLE_KEYWORDS = /\b(explain|help|describe|tell me|show me|list|define|meaning)\b/i;
const COMPLEX_KEYWORDS =
  /\b(generate|create|implement|build|write|deploy|configure|set up|migrate|refactor|convert)\b/i;
const CODE_INDICATORS = /```|@file|\.tf\b|\.ya?ml\b|\.json\b|\.ts\b|\.py\b|\.go\b|\.rs\b/i;
const MULTI_STEP = /\b(first|then|next|after|finally|step\s*\d|phase\s*\d|\d\.\s)/i;

/**
 * Classify prompt complexity via keyword/token analysis.
 *
 * - **Simple** (score < 0.3): short prompts, question words, "explain"/"help"
 * - **Complex** (score > 0.7): long prompts, "generate"/"create"/"implement", multi-step
 * - **Moderate**: everything in between — no routing override
 */
export function classifyPromptComplexity(prompt: string): PromptComplexity {
  const words = prompt.split(/\s+/).length;
  let score = 0;
  const reasons: string[] = [];

  // Length scoring
  if (words < 20) {
    score -= 0.2;
    reasons.push("short prompt");
  } else if (words > 100) {
    score += 0.3;
    reasons.push("long prompt");
  } else if (words > 50) {
    score += 0.1;
  }

  // Question pattern
  if (SIMPLE_STARTERS.test(prompt)) {
    score -= 0.2;
    reasons.push("question pattern");
  }

  // Simple keyword signals
  if (SIMPLE_KEYWORDS.test(prompt)) {
    score -= 0.15;
    reasons.push("simple keywords");
  }

  // Complex keyword signals
  if (COMPLEX_KEYWORDS.test(prompt)) {
    score += 0.25;
    reasons.push("generation keywords");
  }

  // Code indicators
  if (CODE_INDICATORS.test(prompt)) {
    score += 0.15;
    reasons.push("code references");
  }

  // Multi-step instructions
  if (MULTI_STEP.test(prompt)) {
    score += 0.2;
    reasons.push("multi-step");
  }

  // Multiple @file references
  const fileRefs = (prompt.match(/@\S+/g) ?? []).length;
  if (fileRefs > 1) {
    score += 0.15;
    reasons.push(`${fileRefs} file refs`);
  }

  // Normalize to 0–1
  const normalized = Math.max(0, Math.min(1, score + 0.5));

  let level: PromptComplexity["level"];
  if (normalized < 0.3) level = "simple";
  else if (normalized > 0.7) level = "complex";
  else level = "moderate";

  return { level, score: normalized, reason: reasons.join(", ") || "baseline" };
}

/**
 * Match prompt complexity against routing rules. Returns a model override
 * (and optional provider override) when a rule matches, or undefined to use defaults.
 */
export function resolveModelForPrompt(
  prompt: string,
  config: ModelRoutingConfig,
): { model: string; provider?: string; reason: string } | undefined {
  if (!config.enabled || config.rules.length === 0) return undefined;

  const complexity = classifyPromptComplexity(prompt);

  for (const rule of config.rules) {
    let matched = false;

    switch (rule.match) {
      case "simple":
        matched = complexity.level === "simple";
        break;
      case "complex":
        matched = complexity.level === "complex";
        break;
      case "code":
        matched = CODE_INDICATORS.test(prompt);
        break;
      case "review":
        matched = /\b(review|audit|check|analyze|inspect)\b/i.test(prompt);
        break;
      case "analysis":
        matched = /\b(analyze|compare|evaluate|assess|benchmark)\b/i.test(prompt);
        break;
    }

    if (matched) {
      return {
        model: rule.model,
        provider: rule.provider,
        reason: `${rule.match} routing (${complexity.reason})`,
      };
    }
  }

  return undefined;
}
