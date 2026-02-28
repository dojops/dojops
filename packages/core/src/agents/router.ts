import { LLMProvider } from "../llm/provider";
import { SpecialistAgent, SpecialistConfig } from "./specialist";
import { ALL_SPECIALIST_CONFIGS } from "./specialists";

export interface RouteResult {
  agent: SpecialistAgent;
  confidence: number;
  reason: string;
}

export class AgentRouter {
  private agents: SpecialistAgent[];

  constructor(
    private provider: LLMProvider,
    configs: SpecialistConfig[] = ALL_SPECIALIST_CONFIGS,
  ) {
    this.agents = configs.map((c) => new SpecialistAgent(provider, c));
  }

  route(prompt: string): RouteResult {
    const lower = prompt.toLowerCase();
    const scored: Array<{ agent: SpecialistAgent; confidence: number; keywords: string[] }> = [];

    for (const agent of this.agents) {
      const matchedKeywords = agent.keywords.filter((kw) => lower.includes(kw));
      if (matchedKeywords.length === 0) continue;

      const matchRatio = matchedKeywords.length / agent.keywords.length;
      const confidence = Math.min(
        matchedKeywords.length * 0.25 +
          matchRatio * 0.25 +
          (matchedKeywords.length >= 3 ? 0.15 : 0),
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
