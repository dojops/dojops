import { describe, it, expect, vi, afterEach } from "vitest";
import { RoutingProvider } from "../../llm/routing-provider";
import type { LLMProvider, LLMRequest } from "../../llm/provider";
import type { LLMToolRequest } from "../../llm/tool-types";

/** Create a mock provider that records which model it was created for. */
function createMockProvider(
  name: string,
  model?: string,
  overrides?: Partial<LLMProvider>,
): LLMProvider {
  return {
    name,
    generate: vi.fn(async () => ({ content: `response from ${model ?? name}` })),
    generateWithTools: vi.fn(async () => ({
      content: `tool response from ${model ?? name}`,
      toolCalls: [],
      stopReason: "end_turn" as const,
    })),
    ...overrides,
  };
}

function setup(opts?: {
  skillHint?: string;
  forceTier?: "fast" | "standard" | "premium";
  onRoute?: (result: unknown, request: LLMRequest) => void;
  learningFn?: (
    skillName: string,
  ) => { model: string; tier: "fast" | "standard" | "premium" } | null;
}) {
  // Track which models get created
  const createdModels: string[] = [];
  const providers = new Map<string, LLMProvider>();

  const inner = createMockProvider("openai", "gpt-4o");
  const providerFactory = vi.fn((model: string) => {
    createdModels.push(model);
    const p = createMockProvider("openai", model);
    providers.set(model, p);
    return p;
  });

  const routing = new RoutingProvider(inner, {
    providerFactory,
    ...opts,
  });

  return { routing, inner, providerFactory, createdModels, providers };
}

describe("RoutingProvider", () => {
  const originalEnv = process.env.DOJOPS_MODEL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DOJOPS_MODEL;
    } else {
      process.env.DOJOPS_MODEL = originalEnv;
    }
  });

  it("routes simple prompt to fast tier model", async () => {
    // Short prompt with no complex keywords → simple → fast → gpt-4o-mini
    delete process.env.DOJOPS_MODEL;
    const { routing, providerFactory } = setup();

    await routing.generate({ prompt: "Create a Dockerfile" });

    expect(providerFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("routes complex prompt to premium tier model", async () => {
    delete process.env.DOJOPS_MODEL;
    const { routing, providerFactory } = setup();

    const complexPrompt =
      "Architect a distributed microservice deployment with blue-green strategy, " +
      "fault-tolerance, cross-region federation, and zero-downtime migration " +
      "using terraform and kubernetes and helm and ansible and jenkins";

    await routing.generate({ prompt: complexPrompt });

    expect(providerFactory).toHaveBeenCalledWith("o1");
  });

  it("respects DOJOPS_MODEL override — returns that model for all tiers", async () => {
    process.env.DOJOPS_MODEL = "my-custom-model";
    const { routing, providerFactory } = setup();

    await routing.generate({ prompt: "simple prompt" });

    // getModelForTier respects DOJOPS_MODEL env override
    expect(providerFactory).toHaveBeenCalledWith("my-custom-model");
  });

  it("forceTier overrides complexity detection", async () => {
    delete process.env.DOJOPS_MODEL;
    const { routing, providerFactory } = setup({ forceTier: "premium" });

    // Even a simple prompt should use premium tier
    await routing.generate({ prompt: "hello" });

    expect(providerFactory).toHaveBeenCalledWith("o1");
  });

  it("onRoute callback fires with routing result", async () => {
    delete process.env.DOJOPS_MODEL;
    const onRoute = vi.fn();
    const { routing } = setup({ onRoute });

    const request: LLMRequest = { prompt: "Create a Makefile" };
    await routing.generate(request);

    expect(onRoute).toHaveBeenCalledTimes(1);
    const [result, req] = onRoute.mock.calls[0];
    expect(result).toHaveProperty("model");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("complexity");
    expect(req).toBe(request);
  });

  it("generateWithTools routes based on message content", async () => {
    delete process.env.DOJOPS_MODEL;
    const { routing, providerFactory } = setup();

    const request: LLMToolRequest = {
      messages: [{ role: "user", content: "Create a simple Dockerfile for Node" }],
      tools: [],
    };

    await routing.generateWithTools!(request);

    // Simple prompt → fast tier
    expect(providerFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("skillHint influences complexity classification", async () => {
    delete process.env.DOJOPS_MODEL;
    // "dockerfile" is in SIMPLE_SKILLS → routes to fast even with moderate-length prompt
    const { routing, providerFactory } = setup({ skillHint: "dockerfile" });

    await routing.generate({
      prompt:
        "Create a Dockerfile with multi-stage build for a Node.js application with npm ci and non-root user",
    });

    expect(providerFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("caches provider instances — same tier reuses provider", async () => {
    delete process.env.DOJOPS_MODEL;
    const { routing, providerFactory } = setup();

    // Two simple prompts should create only one fast-tier provider
    await routing.generate({ prompt: "hello" });
    await routing.generate({ prompt: "world" });

    expect(providerFactory).toHaveBeenCalledTimes(1);
  });

  it("learningFn overrides heuristic routing when it returns a result", async () => {
    delete process.env.DOJOPS_MODEL;
    const learningFn = vi.fn().mockReturnValue({ model: "gpt-4o", tier: "standard" });
    const { routing, providerFactory } = setup({
      skillHint: "dockerfile",
      learningFn,
    });

    // Even though skillHint=dockerfile would route to fast, learning says standard
    await routing.generate({ prompt: "Create a Dockerfile" });

    expect(learningFn).toHaveBeenCalledWith("dockerfile");
    expect(providerFactory).toHaveBeenCalledWith("gpt-4o");
  });

  it("learningFn returning null falls through to heuristic", async () => {
    delete process.env.DOJOPS_MODEL;
    const learningFn = vi.fn().mockReturnValue(null);
    const { routing, providerFactory } = setup({
      skillHint: "dockerfile",
      learningFn,
    });

    await routing.generate({ prompt: "Create a Dockerfile" });

    expect(learningFn).toHaveBeenCalledWith("dockerfile");
    // Heuristic: dockerfile is simple → fast tier
    expect(providerFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("exposes inner provider name", () => {
    const { routing } = setup();
    expect(routing.name).toBe("openai");
  });
});
