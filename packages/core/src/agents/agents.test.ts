import { describe, it, expect, vi } from "vitest";
import { SpecialistAgent, SpecialistConfig } from "./specialist";
import { AgentRouter } from "./router";
import { ALL_SPECIALIST_CONFIGS } from "./specialists";
import { LLMProvider, LLMResponse } from "../llm/provider";

function mockProvider(response: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: response,
      model: "mock-model",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    } satisfies LLMResponse),
  };
}

const testConfig: SpecialistConfig = {
  name: "test-specialist",
  domain: "testing",
  systemPrompt: "You are a test specialist.",
  keywords: ["test", "unit", "integration"],
};

describe("SpecialistAgent", () => {
  it("exposes config properties", () => {
    const provider = mockProvider("ok");
    const agent = new SpecialistAgent(provider, testConfig);

    expect(agent.name).toBe("test-specialist");
    expect(agent.domain).toBe("testing");
    expect(agent.keywords).toEqual(["test", "unit", "integration"]);
  });

  it("delegates to provider with config systemPrompt", async () => {
    const provider = mockProvider("result");
    const agent = new SpecialistAgent(provider, testConfig);

    const result = await agent.run({ prompt: "run tests" });

    expect(provider.generate).toHaveBeenCalledWith({
      prompt: "run tests",
      system: "You are a test specialist.",
    });
    expect(result.content).toBe("result");
  });
});

describe("AgentRouter", () => {
  it("routes to the correct specialist by keyword match", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const result = router.route("Deploy a terraform infrastructure stack");
    expect(result.agent.domain).toBe("infrastructure");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reason).toContain("terraform");
  });

  it("routes kubernetes-related prompts to orchestration specialist", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const result = router.route("Create a kubernetes deployment with 3 pods");
    expect(result.agent.domain).toBe("orchestration");
    expect(result.reason).toContain("kubernetes");
  });

  it("routes CI/CD prompts to cicd specialist", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const result = router.route("Set up a CI pipeline with github actions");
    expect(result.agent.domain).toBe("ci-cd");
  });

  it("routes security prompts to security auditor", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const result = router.route("Run a security audit and vulnerability scan");
    expect(result.agent.domain).toBe("security");
  });

  it("falls back to planner when no keywords match", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const result = router.route("Do something completely unrelated to anything");
    expect(result.agent.domain).toBe("planning");
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain("fallback");
  });

  it("picks the highest-confidence match when multiple specialists match", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    // "security scan" matches security specialist strongly
    const result = router.route("security vulnerability scan audit compliance");
    expect(result.agent.domain).toBe("security");
  });

  it("returns all agents via getAgents()", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider);

    const agents = router.getAgents();
    expect(agents).toHaveLength(ALL_SPECIALIST_CONFIGS.length);
    expect(agents.map((a) => a.domain)).toContain("planning");
    expect(agents.map((a) => a.domain)).toContain("infrastructure");
    expect(agents.map((a) => a.domain)).toContain("orchestration");
  });

  it("accepts custom configs", () => {
    const provider = mockProvider("ok");
    const router = new AgentRouter(provider, [testConfig]);

    const agents = router.getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("test-specialist");
  });
});
