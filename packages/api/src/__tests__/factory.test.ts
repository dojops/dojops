import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createProvider,
  createTools,
  createRouter,
  createDebugger,
  createDiffAnalyzer,
} from "../factory";

describe("factory", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("createProvider", () => {
    it("creates OllamaProvider when DOJOPS_PROVIDER=ollama", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      expect(provider.name).toBe("ollama");
    });

    it("creates AnthropicProvider when DOJOPS_PROVIDER=anthropic", () => {
      process.env.DOJOPS_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "test-key";
      const provider = createProvider();
      expect(provider.name).toBe("anthropic");
    });

    it("creates OpenAIProvider by default", () => {
      delete process.env.DOJOPS_PROVIDER;
      process.env.OPENAI_API_KEY = "test-key";
      const provider = createProvider();
      expect(provider.name).toBe("openai");
    });

    it("creates OpenAIProvider for explicit openai", () => {
      process.env.DOJOPS_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-key";
      const provider = createProvider();
      expect(provider.name).toBe("openai");
    });

    it("uses ProviderOptions.provider over env", () => {
      process.env.DOJOPS_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "test-key";
      const provider = createProvider({ provider: "ollama" });
      expect(provider.name).toBe("ollama");
    });

    it("uses ProviderOptions.apiKey for anthropic", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createProvider({ provider: "anthropic", apiKey: "opts-key" });
      expect(provider.name).toBe("anthropic");
    });

    it("uses ProviderOptions.apiKey for openai", () => {
      delete process.env.OPENAI_API_KEY;
      const provider = createProvider({ provider: "openai", apiKey: "opts-key" });
      expect(provider.name).toBe("openai");
    });

    it("throws when anthropic key is missing", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createProvider({ provider: "anthropic" })).toThrow(
        /Anthropic API key is required/,
      );
    });

    it("throws when openai key is missing", () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => createProvider({ provider: "openai" })).toThrow(/OpenAI API key is required/);
    });

    it("backward compatible: no options argument works", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      expect(provider.name).toBe("ollama");
    });
  });

  describe("createTools", () => {
    it("creates all built-in tools (31 .dops skills + any global)", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      const tools = createTools(provider);
      expect(tools.length).toBeGreaterThanOrEqual(31);
      const names = tools.map((t) => t.name);
      expect(names).toContain("github-actions");
      expect(names).toContain("terraform");
      expect(names).toContain("kubernetes");
      expect(names).toContain("helm");
      expect(names).toContain("ansible");
      expect(names).toContain("docker-compose");
      expect(names).toContain("dockerfile");
      expect(names).toContain("nginx");
      expect(names).toContain("makefile");
      expect(names).toContain("jenkinsfile");
      expect(names).toContain("gitlab-ci");
      expect(names).toContain("prometheus");
      expect(names).toContain("systemd");
      expect(names).toContain("grafana");
      expect(names).toContain("otel-collector");
      expect(names).toContain("pulumi");
      expect(names).toContain("argocd");
      expect(names).toContain("cloudformation");
      expect(names).toContain("vault");
      expect(names).toContain("istio");
      expect(names).toContain("kustomize");
      expect(names).toContain("crossplane");
      expect(names).toContain("terragrunt");
      expect(names).toContain("flux");
      expect(names).toContain("falco");
      expect(names).toContain("opa-gatekeeper");
      expect(names).toContain("aws-cdk");
      expect(names).toContain("eks");
      expect(names).toContain("cert-manager");
      expect(names).toContain("trivy-operator");
    });
  });

  describe("createRouter", () => {
    it("creates an AgentRouter with agents", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      const { router } = createRouter(provider);
      expect(router.getAgents().length).toBeGreaterThan(0);
    });

    it("returns empty customAgentNames when no custom agents exist", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      const { customAgentNames } = createRouter(provider);
      expect(customAgentNames.size).toBe(0);
    });
  });

  describe("createDebugger", () => {
    it("creates a CIDebugger instance", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      const debugger_ = createDebugger(provider);
      expect(debugger_).toBeDefined();
      expect(typeof debugger_.diagnose).toBe("function");
    });
  });

  describe("createDiffAnalyzer", () => {
    it("creates an InfraDiffAnalyzer instance", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const provider = createProvider();
      const analyzer = createDiffAnalyzer(provider);
      expect(analyzer).toBeDefined();
      expect(typeof analyzer.analyze).toBe("function");
    });
  });

  describe("allowMissing option (C3 fix)", () => {
    it("returns NoopProvider when allowMissing=true and key is missing", () => {
      delete process.env.OPENAI_API_KEY;
      const provider = createProvider({ provider: "openai", allowMissing: true });
      expect(provider.name).toBe("noop");
    });

    it("NoopProvider.generate() throws descriptive error", async () => {
      delete process.env.OPENAI_API_KEY;
      const provider = createProvider({ provider: "openai", allowMissing: true });
      await expect(provider.generate({ prompt: "test" })).rejects.toThrow(/API key not configured/);
    });

    it("returns NoopProvider for anthropic when allowMissing=true", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const provider = createProvider({ provider: "anthropic", allowMissing: true });
      expect(provider.name).toBe("noop");
    });

    it("returns NoopProvider for deepseek when allowMissing=true", () => {
      delete process.env.DEEPSEEK_API_KEY;
      const provider = createProvider({ provider: "deepseek", allowMissing: true });
      expect(provider.name).toBe("noop");
    });

    it("creates MistralProvider when provider=mistral", () => {
      process.env.MISTRAL_API_KEY = "test-key";
      const provider = createProvider({ provider: "mistral" });
      expect(provider.name).toBe("mistral");
    });

    it("returns NoopProvider for mistral when allowMissing=true", () => {
      delete process.env.MISTRAL_API_KEY;
      const provider = createProvider({ provider: "mistral", allowMissing: true });
      expect(provider.name).toBe("noop");
    });

    it("returns NoopProvider for gemini when allowMissing=true", () => {
      delete process.env.GEMINI_API_KEY;
      const provider = createProvider({ provider: "gemini", allowMissing: true });
      expect(provider.name).toBe("noop");
    });

    it("still creates real provider when key is present", () => {
      process.env.OPENAI_API_KEY = "test-key";
      const provider = createProvider({ provider: "openai", allowMissing: true });
      expect(provider.name).toBe("openai");
    });

    it("ollama ignores allowMissing (never needs key)", () => {
      const provider = createProvider({ provider: "ollama", allowMissing: true });
      expect(provider.name).toBe("ollama");
    });
  });
});
