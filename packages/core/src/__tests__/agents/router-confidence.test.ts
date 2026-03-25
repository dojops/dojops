import { describe, it, expect, vi } from "vitest";
import { AgentRouter } from "../../agents/router";
import { SpecialistConfig } from "../../agents/specialist";
import { LLMProvider, LLMResponse } from "../../llm/provider";

function mockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: "ok",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    } satisfies LLMResponse),
  };
}

/**
 * Formula: confidence = min(matchedKeywords * 0.25 + matchRatio * 0.25 + (matchedKeywords >= 3 ? 0.15 : 0), 1.0)
 * where matchRatio = matchedKeywords.length / max(agent.keywords.length, 10)
 * The denominator is capped at min 10 to prevent bias toward agents with few keywords.
 */
describe("Router confidence formula (H-3)", () => {
  describe("basic calculation", () => {
    const configs: SpecialistConfig[] = [
      {
        name: "orchestrator",
        domain: "orchestration",
        systemPrompt: "You orchestrate.",
        keywords: ["orchestrate", "manage", "coordinate"],
      },
      {
        name: "four-keyword-agent",
        domain: "testing",
        systemPrompt: "Test agent.",
        keywords: ["alpha", "beta", "gamma", "delta"],
      },
    ];

    it("single keyword match (4-keyword agent): confidence ≈ 0.275", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "alpha" matches 1 of 4 keywords, denominator capped at 10
      // confidence = 1 * 0.25 + (1/10) * 0.25 + 0 = 0.25 + 0.025 = 0.275
      const result = router.route("alpha something else");
      // Low confidence < 0.4, should fall to orchestrator
      expect(result.confidence).toBeCloseTo(0.275, 4);
      expect(result.agent.domain).toBe("orchestration");
    });

    it("two keyword matches (4-keyword agent): confidence = 0.55", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "alpha beta" matches 2 of 4 keywords, denominator capped at 10
      // confidence = 2 * 0.25 + (2/10) * 0.25 + 0 = 0.5 + 0.05 = 0.55
      const result = router.route("alpha and beta together");
      expect(result.confidence).toBeCloseTo(0.55, 4);
      expect(result.agent.domain).toBe("testing");
    });

    it("three keyword matches → bonus applied", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "alpha beta gamma" matches 3 of 4 keywords, denominator capped at 10
      // confidence = 3 * 0.25 + (3/10) * 0.25 + 0.15 = 0.75 + 0.075 + 0.15 = 0.975
      const result = router.route("alpha beta gamma query");
      expect(result.confidence).toBeCloseTo(0.975, 4);
      expect(result.agent.domain).toBe("testing");
    });

    it("all keywords match → capped at 1.0", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // 4 of 4: confidence = 4*0.25 + (4/10)*0.25 + 0.15 = 1.0 + 0.1 + 0.15 = min(1.25, 1.0) = 1.0
      const result = router.route("alpha beta gamma delta");
      expect(result.confidence).toBe(1);
      expect(result.agent.domain).toBe("testing");
    });

    it("no keywords match → confidence 0, routes to fallback", () => {
      const router = new AgentRouter(mockProvider(), configs);
      const result = router.route("completely unrelated query");
      expect(result.confidence).toBe(0);
      expect(result.agent.domain).toBe("orchestration");
      expect(result.reason).toContain("No domain match");
    });
  });

  describe("low confidence fallback (< 0.4)", () => {
    const configs: SpecialistConfig[] = [
      {
        name: "orchestrator",
        domain: "orchestration",
        systemPrompt: "Orchestrator.",
        keywords: ["orchestrate"],
      },
      {
        name: "big-agent",
        domain: "infra",
        systemPrompt: "Infra.",
        keywords: ["terraform", "hcl", "cloud", "infrastructure", "provider"],
      },
    ];

    it("routes to orchestrator when confidence below 0.4", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "hcl" matches 1 of 5 keywords
      // confidence = 1*0.25 + (1/5)*0.25 + 0 = 0.25 + 0.05 = 0.30
      const result = router.route("write some hcl code");
      expect(result.confidence).toBeLessThan(0.4);
      expect(result.agent.domain).toBe("orchestration");
      expect(result.reason).toContain("Low confidence");
    });

    it("routes to specialist when confidence ≥ 0.4", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "terraform cloud" matches 2 of 5 keywords
      // confidence = 2*0.25 + (2/5)*0.25 + 0 = 0.5 + 0.1 = 0.6
      const result = router.route("deploy terraform cloud resources");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
      expect(result.agent.domain).toBe("infra");
    });

    it("reason mentions matched keywords", () => {
      const router = new AgentRouter(mockProvider(), configs);
      const result = router.route("write hcl code");
      expect(result.reason).toContain("hcl");
    });
  });

  describe("multi-domain ambiguity (within 0.1)", () => {
    const configs: SpecialistConfig[] = [
      {
        name: "orchestrator",
        domain: "orchestration",
        systemPrompt: "Orchestrator.",
        keywords: ["orchestrate"],
      },
      {
        name: "agent-a",
        domain: "domain-a",
        systemPrompt: "Agent A.",
        keywords: ["terraform", "hcl", "infrastructure"],
      },
      {
        name: "agent-b",
        domain: "domain-b",
        systemPrompt: "Agent B.",
        keywords: ["kubernetes", "k8s", "deployment", "pod"],
      },
    ];

    it("routes to orchestrator when top 2 within 0.1 (different domains)", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "terraform hcl" matches agent-a: 2 of 3 (capped to 10) -> 2*0.25 + (2/10)*0.25 = 0.55
      // "kubernetes deployment" matches agent-b: 2 of 4 (capped to 10) -> 2*0.25 + (2/10)*0.25 = 0.55
      // Difference: 0.0 < 0.1 -> ambiguity
      const result = router.route("terraform hcl kubernetes deployment");
      expect(result.agent.domain).toBe("orchestration");
      expect(result.reason).toContain("Ambiguous");
      expect(result.reason).toContain("agent-a");
      expect(result.reason).toContain("agent-b");
    });

    it("no ambiguity when top 2 same domain", () => {
      const sameDomainConfigs: SpecialistConfig[] = [
        {
          name: "orchestrator",
          domain: "orchestration",
          systemPrompt: "Orchestrator.",
          keywords: ["orchestrate"],
        },
        {
          name: "agent-a",
          domain: "infra",
          systemPrompt: "Agent A.",
          keywords: ["terraform", "hcl"],
        },
        {
          name: "agent-b",
          domain: "infra",
          systemPrompt: "Agent B.",
          keywords: ["cloud", "infrastructure"],
        },
      ];
      const router = new AgentRouter(mockProvider(), sameDomainConfigs);
      // Both agents match with similar scores but same domain -> no ambiguity
      const result = router.route("terraform hcl cloud infrastructure");
      expect(result.reason).not.toContain("Ambiguous");
    });

    it("no ambiguity when gap exceeds 0.1", () => {
      const router = new AgentRouter(mockProvider(), configs);
      // "terraform hcl infrastructure" matches agent-a: 3 of 3 (capped to 10) -> 3*0.25 + (3/10)*0.25 + 0.15 = 0.975
      // No match for agent-b -> gap > 0.1
      const result = router.route("terraform hcl infrastructure only");
      expect(result.agent.domain).toBe("domain-a");
      expect(result.reason).not.toContain("Ambiguous");
    });
  });

  describe("H-8: systemd keywords", () => {
    it('routes "create a systemd service unit" to shell-scripting', () => {
      const router = new AgentRouter(mockProvider());
      const result = router.route("create a systemd service unit");
      expect(result.agent.domain).toBe("shell-scripting");
    });

    it('routes "configure systemd timer" to shell-scripting', () => {
      const router = new AgentRouter(mockProvider());
      const result = router.route("configure systemd timer for backup");
      expect(result.agent.domain).toBe("shell-scripting");
    });

    it('routes "check journalctl output for systemd unit" to shell-scripting', () => {
      const router = new AgentRouter(mockProvider());
      const result = router.route("check journalctl output for systemd unit status");
      expect(result.agent.domain).toBe("shell-scripting");
    });

    it("shell specialist beats other domains for systemd prompts", () => {
      const router = new AgentRouter(mockProvider());
      const result = router.route("write a systemd service unit timer");
      expect(result.agent.domain).toBe("shell-scripting");
      expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    });
  });

  describe("formula edge cases", () => {
    it("single-keyword agent with match → confidence 0.275 (capped denominator)", () => {
      const configs: SpecialistConfig[] = [
        {
          name: "fallback",
          domain: "orchestration",
          systemPrompt: "Orchestrator.",
          keywords: ["orchestrate"],
        },
        {
          name: "tiny-agent",
          domain: "tiny",
          systemPrompt: "Tiny.",
          keywords: ["unique"],
        },
      ];
      const router = new AgentRouter(mockProvider(), configs);
      // "unique" matches 1 of 1 keywords, denominator capped at 10
      // confidence = 1*0.25 + (1/10)*0.25 + 0 = 0.25 + 0.025 = 0.275
      // Below 0.4 threshold -> falls to orchestrator
      const result = router.route("a unique query");
      expect(result.confidence).toBeCloseTo(0.275, 4);
      expect(result.agent.domain).toBe("orchestration");
    });

    it("keywords matched case-insensitively", () => {
      const configs: SpecialistConfig[] = [
        {
          name: "fallback",
          domain: "orchestration",
          systemPrompt: "Orchestrator.",
          keywords: ["orchestrate"],
        },
        {
          name: "test-agent",
          domain: "test",
          systemPrompt: "Test.",
          keywords: ["terraform", "kubernetes"],
        },
      ];
      const router = new AgentRouter(mockProvider(), configs);
      const result = router.route("Deploy TERRAFORM and KUBERNETES resources");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.agent.domain).toBe("test");
    });
  });
});
