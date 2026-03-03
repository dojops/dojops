import { LLMProvider } from "../llm/provider";
import { SpecialistAgent, SpecialistConfig } from "./specialist";
import { ALL_SPECIALIST_CONFIGS } from "./specialists";

export interface RouteResult {
  agent: SpecialistAgent;
  confidence: number;
  reason: string;
}

export interface RouteOptions {
  /** Project domains detected by `dojops init`. Boosts agents whose domain matches. */
  projectDomains?: string[];
}

export class AgentRouter {
  private agents: SpecialistAgent[];

  constructor(
    private provider: LLMProvider,
    configs: SpecialistConfig[] = ALL_SPECIALIST_CONFIGS,
    private docAugmenter?: {
      augmentPrompt(s: string, kw: string[], q: string): Promise<string>;
    },
  ) {
    this.agents = configs.map((c) => new SpecialistAgent(provider, c, docAugmenter));
  }

  /**
   * Check if a keyword matches in the prompt using word boundary awareness.
   * Multi-word keywords use substring match (already specific enough).
   * Single-word keywords use word boundary regex to avoid false positives
   * (e.g., "ci" shouldn't match "circuit").
   */
  private matchesKeyword(lower: string, kw: string): boolean {
    if (kw.includes(" ")) {
      // Multi-word keywords are specific enough for substring match
      return lower.includes(kw);
    }
    // Single-word: use word boundary matching
    // \b handles punctuation, hyphens, and whitespace boundaries
    return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower);
  }

  route(prompt: string, options?: RouteOptions): RouteResult {
    const lower = prompt.toLowerCase();
    const projectDomains = new Set(options?.projectDomains ?? []);
    const scored: Array<{ agent: SpecialistAgent; confidence: number; keywords: string[] }> = [];

    for (const agent of this.agents) {
      const matchedKeywords = agent.keywords.filter((kw) => this.matchesKeyword(lower, kw));
      if (matchedKeywords.length === 0) continue;

      const matchRatio = matchedKeywords.length / agent.keywords.length;

      // Primary keyword bonus: each matched primary keyword adds +0.1 confidence
      const primarySet = new Set(agent.primaryKeywords);
      const primaryMatchCount = matchedKeywords.filter((kw) => primarySet.has(kw)).length;
      const primaryBonus = primaryMatchCount * 0.1;

      // Project context bonus: +0.15 when agent domain matches project domains
      const contextBonus = projectDomains.has(agent.domain) ? 0.15 : 0;

      const confidence = Math.min(
        matchedKeywords.length * 0.25 +
          matchRatio * 0.25 +
          (matchedKeywords.length >= 3 ? 0.15 : 0) +
          primaryBonus +
          contextBonus,
        1.0,
      );

      scored.push({ agent, confidence, keywords: matchedKeywords });
    }

    // Sort by confidence descending
    scored.sort((a, b) => b.confidence - a.confidence);

    const fallback = this.agents.find((a) => a.domain === "orchestration") ?? this.agents[0];
    if (!fallback) {
      throw new Error("AgentRouter has no agents configured");
    }

    if (scored.length === 0) {
      return {
        agent: fallback,
        confidence: 0,
        reason: `No domain match, routing to ${fallback.name}`,
      };
    }

    const best = scored[0];

    // Low confidence — fall through to orchestrator
    if (best.confidence < 0.4) {
      return {
        agent: fallback,
        confidence: best.confidence,
        reason: `Low confidence match (${best.keywords.join(", ")}), routing to ${fallback.name}`,
      };
    }

    // Multi-domain ambiguity: if top 2 agents are within 0.1 of each other,
    // route to orchestrator for decomposition
    if (
      scored.length >= 2 &&
      scored[0].confidence - scored[1].confidence < 0.1 &&
      scored[0].agent.domain !== scored[1].agent.domain
    ) {
      return {
        agent: fallback,
        confidence: scored[0].confidence,
        reason: `Ambiguous match between ${scored[0].agent.name} and ${scored[1].agent.name}, routing to ${fallback.name}`,
      };
    }

    return {
      agent: best.agent,
      confidence: best.confidence,
      reason: `Matched keywords: ${best.keywords.join(", ")}`,
    };
  }

  getAgents(): SpecialistAgent[] {
    return [...this.agents];
  }
}
