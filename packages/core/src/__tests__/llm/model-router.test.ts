import { describe, it, expect, afterEach } from "vitest";
import {
  classifyTaskComplexity,
  selectModelTier,
  getModelForTier,
  routeModel,
  estimateCost,
  isModelCompatibleWithProvider,
  PROVIDER_MODEL_TIERS,
  PROVIDER_COST_PER_M_TOKENS,
} from "../../llm/model-router";

describe("classifyTaskComplexity", () => {
  describe("simple tasks", () => {
    it("classifies short prompts as simple", () => {
      expect(classifyTaskComplexity("Create an S3 bucket")).toBe("simple");
    });

    it("classifies prompts under 100 words as simple", () => {
      const prompt = "Set up a basic nginx config for serving static files on port 80";
      expect(classifyTaskComplexity(prompt)).toBe("simple");
    });

    it("classifies known simple skills as simple regardless of prompt length", () => {
      const prompt =
        "Configure a systemd service for my Node.js application with restart on failure";
      expect(classifyTaskComplexity(prompt, "systemd")).toBe("simple");
    });

    it("classifies makefile skill as simple", () => {
      expect(classifyTaskComplexity("Build a Makefile for my Go project", "makefile")).toBe(
        "simple",
      );
    });

    it("classifies nginx skill as simple", () => {
      expect(classifyTaskComplexity("Reverse proxy config for my API", "nginx")).toBe("simple");
    });

    it("classifies dockerfile skill as simple", () => {
      expect(classifyTaskComplexity("Multi-stage build for Node.js", "dockerfile")).toBe("simple");
    });
  });

  describe("moderate tasks", () => {
    it("classifies prompts between 100-500 words as moderate", () => {
      const filler = Array(150).fill("context").join(" ");
      expect(classifyTaskComplexity(`Create a deployment configuration ${filler}`)).toBe(
        "moderate",
      );
    });

    it("classifies short prompts with 2 skill references as moderate", () => {
      expect(classifyTaskComplexity("Set up Terraform and Kubernetes for my project")).toBe(
        "moderate",
      );
    });
  });

  describe("complex tasks", () => {
    it("classifies prompts with architecture keywords as complex", () => {
      expect(classifyTaskComplexity("Design a multi-cloud disaster recovery strategy")).toBe(
        "complex",
      );
    });

    it("classifies prompts with migration keyword as complex", () => {
      expect(classifyTaskComplexity("Migrate our monolith to microservices")).toBe("complex");
    });

    it("classifies prompts over 500 words as complex", () => {
      const longPrompt = Array(510).fill("word").join(" ");
      expect(classifyTaskComplexity(longPrompt)).toBe("complex");
    });

    it("classifies prompts with 3+ skill references as complex", () => {
      expect(
        classifyTaskComplexity(
          "I need Terraform for infra, Kubernetes for orchestration, and Helm for packaging " +
            Array(80).fill("additional context").join(" "),
        ),
      ).toBe("complex");
    });

    it("overrides simple skill when architecture keywords present", () => {
      expect(
        classifyTaskComplexity(
          "Design a distributed nginx config for blue-green deployment",
          "nginx",
        ),
      ).toBe("complex");
    });

    it("detects zero-downtime keyword", () => {
      expect(classifyTaskComplexity("Implement zero-downtime deployment for the cluster")).toBe(
        "complex",
      );
    });

    it("detects high-availability keyword", () => {
      expect(
        classifyTaskComplexity("Set up high-availability PostgreSQL with cross-region replication"),
      ).toBe("complex");
    });

    it("detects canary keyword", () => {
      expect(classifyTaskComplexity("Configure canary deployments for our services")).toBe(
        "complex",
      );
    });
  });
});

describe("selectModelTier", () => {
  it("returns fast for routing calls regardless of complexity", () => {
    expect(selectModelTier("complex", false, true)).toBe("fast");
    expect(selectModelTier("moderate", true, true)).toBe("fast");
    expect(selectModelTier("simple", false, true)).toBe("fast");
  });

  it("returns fast for simple tasks", () => {
    expect(selectModelTier("simple", false, false)).toBe("fast");
  });

  it("returns fast for simple tasks even with structured output", () => {
    expect(selectModelTier("simple", true, false)).toBe("fast");
  });

  it("returns standard for moderate tasks", () => {
    expect(selectModelTier("moderate", false, false)).toBe("standard");
  });

  it("returns standard for moderate tasks with structured output", () => {
    expect(selectModelTier("moderate", true, false)).toBe("standard");
  });

  it("returns premium for complex tasks", () => {
    expect(selectModelTier("complex", false, false)).toBe("premium");
  });

  it("returns premium for complex tasks with structured output", () => {
    expect(selectModelTier("complex", true, false)).toBe("premium");
  });
});

describe("getModelForTier", () => {
  const originalEnv = process.env.DOJOPS_MODEL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DOJOPS_MODEL;
    } else {
      process.env.DOJOPS_MODEL = originalEnv;
    }
  });

  it("returns correct model for each openai tier", () => {
    expect(getModelForTier("openai", "fast")).toBe("gpt-4o-mini");
    expect(getModelForTier("openai", "standard")).toBe("gpt-4o");
    expect(getModelForTier("openai", "premium")).toBe("o1");
  });

  it("returns correct model for each anthropic tier", () => {
    expect(getModelForTier("anthropic", "fast")).toBe("claude-haiku-4-5-20251001");
    expect(getModelForTier("anthropic", "standard")).toBe("claude-sonnet-4-6");
    expect(getModelForTier("anthropic", "premium")).toBe("claude-opus-4-6");
  });

  it("returns correct model for each ollama tier", () => {
    expect(getModelForTier("ollama", "fast")).toBe("llama3.2:3b");
    expect(getModelForTier("ollama", "standard")).toBe("llama3.1:8b");
    expect(getModelForTier("ollama", "premium")).toBe("llama3.1:70b");
  });

  it("returns correct model for each deepseek tier", () => {
    expect(getModelForTier("deepseek", "fast")).toBe("deepseek-chat");
    expect(getModelForTier("deepseek", "standard")).toBe("deepseek-chat");
    expect(getModelForTier("deepseek", "premium")).toBe("deepseek-reasoner");
  });

  it("returns correct model for each mistral tier", () => {
    expect(getModelForTier("mistral", "fast")).toBe("mistral-small-latest");
    expect(getModelForTier("mistral", "standard")).toBe("mistral-medium-latest");
    expect(getModelForTier("mistral", "premium")).toBe("mistral-large-latest");
  });

  it("returns correct model for each gemini tier", () => {
    expect(getModelForTier("gemini", "fast")).toBe("gemini-2.0-flash");
    expect(getModelForTier("gemini", "standard")).toBe("gemini-2.5-pro");
    expect(getModelForTier("gemini", "premium")).toBe("gemini-2.5-pro");
  });

  it("returns correct model for each github-copilot tier", () => {
    expect(getModelForTier("github-copilot", "fast")).toBe("gpt-4o-mini");
    expect(getModelForTier("github-copilot", "standard")).toBe("gpt-4o");
    expect(getModelForTier("github-copilot", "premium")).toBe("o1");
  });

  it("returns all providers listed in PROVIDER_MODEL_TIERS", () => {
    for (const [provider, tiers] of Object.entries(PROVIDER_MODEL_TIERS)) {
      expect(getModelForTier(provider, "fast")).toBe(tiers.fast);
      expect(getModelForTier(provider, "standard")).toBe(tiers.standard);
      expect(getModelForTier(provider, "premium")).toBe(tiers.premium);
    }
  });

  it("throws for unknown provider", () => {
    expect(() => getModelForTier("unknown-provider", "fast")).toThrow(
      'Unknown provider "unknown-provider"',
    );
  });

  describe("DOJOPS_MODEL override", () => {
    it("overrides tier selection when set", () => {
      process.env.DOJOPS_MODEL = "my-custom-model";
      expect(getModelForTier("openai", "fast")).toBe("my-custom-model");
      expect(getModelForTier("anthropic", "premium")).toBe("my-custom-model");
    });

    it("overrides for all tiers", () => {
      process.env.DOJOPS_MODEL = "override-model";
      expect(getModelForTier("openai", "fast")).toBe("override-model");
      expect(getModelForTier("openai", "standard")).toBe("override-model");
      expect(getModelForTier("openai", "premium")).toBe("override-model");
    });

    it("does not override when env var is empty string", () => {
      process.env.DOJOPS_MODEL = "";
      // Empty string is falsy, so no override
      expect(getModelForTier("openai", "fast")).toBe("gpt-4o-mini");
    });
  });
});

describe("routeModel", () => {
  const originalEnv = process.env.DOJOPS_MODEL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DOJOPS_MODEL;
    } else {
      process.env.DOJOPS_MODEL = originalEnv;
    }
  });

  it("routes simple prompt to fast tier", () => {
    const result = routeModel("openai", "Create an S3 bucket");
    expect(result.complexity).toBe("simple");
    expect(result.tier).toBe("fast");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("routes complex prompt to premium tier", () => {
    const result = routeModel("anthropic", "Design a multi-cloud disaster recovery architecture");
    expect(result.complexity).toBe("complex");
    expect(result.tier).toBe("premium");
    expect(result.model).toBe("claude-opus-4-6");
  });

  it("routes moderate prompt to standard tier", () => {
    const filler = Array(150).fill("context").join(" ");
    const result = routeModel("mistral", `Configure the deployment ${filler}`);
    expect(result.complexity).toBe("moderate");
    expect(result.tier).toBe("standard");
    expect(result.model).toBe("mistral-medium-latest");
  });

  it("uses fast tier when isRouting is true", () => {
    const filler = Array(150).fill("context").join(" ");
    const result = routeModel("openai", `Design architecture ${filler}`, { isRouting: true });
    expect(result.tier).toBe("fast");
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("respects skillName for simple classification", () => {
    const result = routeModel("gemini", "Build a Makefile for my project", {
      skillName: "makefile",
    });
    expect(result.complexity).toBe("simple");
    expect(result.tier).toBe("fast");
    expect(result.model).toBe("gemini-2.0-flash");
  });

  it("respects DOJOPS_MODEL override", () => {
    process.env.DOJOPS_MODEL = "custom-model";
    const result = routeModel("openai", "Create an S3 bucket");
    expect(result.model).toBe("custom-model");
    // Complexity and tier are still computed
    expect(result.complexity).toBe("simple");
    expect(result.tier).toBe("fast");
  });

  it("works for all providers with a simple prompt", () => {
    const prompt = "Create a config file";
    for (const provider of Object.keys(PROVIDER_MODEL_TIERS)) {
      const result = routeModel(provider, prompt);
      expect(result.tier).toBe("fast");
      expect(result.model).toBe(PROVIDER_MODEL_TIERS[provider].fast);
    }
  });

  it("throws for unknown provider", () => {
    expect(() => routeModel("nonexistent", "test prompt")).toThrow(
      'Unknown provider "nonexistent"',
    );
  });

  it("defaults isStructuredOutput and isRouting to false", () => {
    const result = routeModel("openai", "Create an S3 bucket");
    // simple + not routing + not structured = fast
    expect(result.tier).toBe("fast");
  });
});

describe("estimateCost", () => {
  it("calculates cost for openai fast tier", () => {
    const cost = estimateCost("openai", "fast", 1_000_000, 1_000_000);
    // 0.15 input + 0.60 output = 0.75
    expect(cost).toBeCloseTo(0.75);
  });

  it("calculates cost for anthropic premium tier", () => {
    const cost = estimateCost("anthropic", "premium", 500_000, 200_000);
    // (0.5 * 15) + (0.2 * 75) = 7.5 + 15 = 22.5
    expect(cost).toBeCloseTo(22.5);
  });

  it("returns 0 for ollama (local)", () => {
    const cost = estimateCost("ollama", "standard", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });

  it("returns 0 for github-copilot (included in subscription)", () => {
    const cost = estimateCost("github-copilot", "premium", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });

  it("returns 0 for unknown provider", () => {
    const cost = estimateCost("unknown", "fast", 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });

  it("scales linearly with token count", () => {
    const cost1 = estimateCost("openai", "standard", 100_000, 50_000);
    const cost2 = estimateCost("openai", "standard", 200_000, 100_000);
    expect(cost2).toBeCloseTo(cost1 * 2);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("openai", "premium", 0, 0)).toBe(0);
  });

  it("has cost entries for all providers in PROVIDER_MODEL_TIERS", () => {
    for (const provider of Object.keys(PROVIDER_MODEL_TIERS)) {
      expect(PROVIDER_COST_PER_M_TOKENS[provider]).toBeDefined();
      expect(PROVIDER_COST_PER_M_TOKENS[provider].fast).toBeDefined();
      expect(PROVIDER_COST_PER_M_TOKENS[provider].standard).toBeDefined();
      expect(PROVIDER_COST_PER_M_TOKENS[provider].premium).toBeDefined();
    }
  });
});

describe("isModelCompatibleWithProvider", () => {
  it("accepts OpenAI models on openai provider", () => {
    expect(isModelCompatibleWithProvider("gpt-4o", "openai")).toBe(true);
    expect(isModelCompatibleWithProvider("gpt-4o-mini", "openai")).toBe(true);
    expect(isModelCompatibleWithProvider("o1", "openai")).toBe(true);
    expect(isModelCompatibleWithProvider("o3-mini", "openai")).toBe(true);
  });

  it("rejects OpenAI models on anthropic provider", () => {
    expect(isModelCompatibleWithProvider("gpt-4o", "anthropic")).toBe(false);
    expect(isModelCompatibleWithProvider("gpt-4o-mini", "anthropic")).toBe(false);
    expect(isModelCompatibleWithProvider("o1", "anthropic")).toBe(false);
  });

  it("accepts Anthropic models on anthropic provider", () => {
    expect(isModelCompatibleWithProvider("claude-sonnet-4-6", "anthropic")).toBe(true);
    expect(isModelCompatibleWithProvider("claude-opus-4-6", "anthropic")).toBe(true);
    expect(isModelCompatibleWithProvider("claude-haiku-4-5-20251001", "anthropic")).toBe(true);
  });

  it("rejects Anthropic models on openai provider", () => {
    expect(isModelCompatibleWithProvider("claude-sonnet-4-6", "openai")).toBe(false);
    expect(isModelCompatibleWithProvider("claude-opus-4-6", "openai")).toBe(false);
  });

  it("rejects DeepSeek models on anthropic provider", () => {
    expect(isModelCompatibleWithProvider("deepseek-chat", "anthropic")).toBe(false);
    expect(isModelCompatibleWithProvider("deepseek-reasoner", "anthropic")).toBe(false);
  });

  it("accepts DeepSeek models on deepseek provider", () => {
    expect(isModelCompatibleWithProvider("deepseek-chat", "deepseek")).toBe(true);
    expect(isModelCompatibleWithProvider("deepseek-reasoner", "deepseek")).toBe(true);
  });

  it("rejects Gemini models on openai provider", () => {
    expect(isModelCompatibleWithProvider("gemini-2.0-flash", "openai")).toBe(false);
    expect(isModelCompatibleWithProvider("gemini-2.5-pro", "openai")).toBe(false);
  });

  it("accepts Gemini models on gemini provider", () => {
    expect(isModelCompatibleWithProvider("gemini-2.0-flash", "gemini")).toBe(true);
    expect(isModelCompatibleWithProvider("gemini-2.5-pro", "gemini")).toBe(true);
  });

  it("rejects Mistral models on openai provider", () => {
    expect(isModelCompatibleWithProvider("mistral-large-latest", "openai")).toBe(false);
    expect(isModelCompatibleWithProvider("codestral-latest", "openai")).toBe(false);
  });

  it("accepts Mistral models on mistral provider", () => {
    expect(isModelCompatibleWithProvider("mistral-large-latest", "mistral")).toBe(true);
    expect(isModelCompatibleWithProvider("mistral-small-latest", "mistral")).toBe(true);
    expect(isModelCompatibleWithProvider("codestral-latest", "mistral")).toBe(true);
  });

  it("allows any model on ollama (local runner)", () => {
    expect(isModelCompatibleWithProvider("gpt-4o", "ollama")).toBe(true);
    expect(isModelCompatibleWithProvider("claude-sonnet-4-6", "ollama")).toBe(true);
    expect(isModelCompatibleWithProvider("llama3.1:8b", "ollama")).toBe(true);
    expect(isModelCompatibleWithProvider("custom-model", "ollama")).toBe(true);
  });

  it("allows any model on github-copilot", () => {
    expect(isModelCompatibleWithProvider("gpt-4o", "github-copilot")).toBe(true);
    expect(isModelCompatibleWithProvider("custom-model", "github-copilot")).toBe(true);
  });

  it("allows unknown model names (custom/fine-tuned) on any provider", () => {
    expect(isModelCompatibleWithProvider("my-finetuned-model", "openai")).toBe(true);
    expect(isModelCompatibleWithProvider("my-finetuned-model", "anthropic")).toBe(true);
    expect(isModelCompatibleWithProvider("llama3.1:8b", "deepseek")).toBe(true);
  });

  it("allows unknown providers (benefit of the doubt)", () => {
    expect(isModelCompatibleWithProvider("any-model", "unknown-provider")).toBe(true);
  });
});
