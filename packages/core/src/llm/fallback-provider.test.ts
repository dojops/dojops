import { describe, it, expect, vi } from "vitest";
import { FallbackProvider } from "./fallback-provider";
import { LLMProvider, LLMResponse } from "./provider";

function createMockProvider(name: string, overrides?: Partial<LLMProvider>): LLMProvider {
  return {
    name,
    generate: vi.fn(async () => ({ content: `response from ${name}` })),
    ...overrides,
  };
}

describe("FallbackProvider", () => {
  describe("constructor", () => {
    it("throws when initialized with empty providers array", () => {
      expect(() => new FallbackProvider([])).toThrow(
        "FallbackProvider requires at least one provider",
      );
    });

    it("creates name from single provider", () => {
      const p = createMockProvider("openai");
      const fb = new FallbackProvider([p]);
      expect(fb.name).toBe("fallback(openai)");
    });

    it("creates name from multiple providers", () => {
      const p1 = createMockProvider("openai");
      const p2 = createMockProvider("anthropic");
      const fb = new FallbackProvider([p1, p2]);
      expect(fb.name).toBe("fallback(openai,anthropic)");
    });

    it("creates name from three providers", () => {
      const fb = new FallbackProvider([
        createMockProvider("openai"),
        createMockProvider("anthropic"),
        createMockProvider("ollama"),
      ]);
      expect(fb.name).toBe("fallback(openai,anthropic,ollama)");
    });
  });

  describe("generate()", () => {
    it("returns response from first provider when it succeeds", async () => {
      const p1 = createMockProvider("openai");
      const p2 = createMockProvider("anthropic");
      const fb = new FallbackProvider([p1, p2]);

      const result = await fb.generate({ prompt: "test" });
      expect(result.content).toBe("response from openai");
      expect(p1.generate).toHaveBeenCalledTimes(1);
      expect(p2.generate).not.toHaveBeenCalled();
    });

    it("falls through to second provider when first fails", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(new Error("rate limited")),
      });
      const p2 = createMockProvider("anthropic");
      const fb = new FallbackProvider([p1, p2]);

      const result = await fb.generate({ prompt: "test" });
      expect(result.content).toBe("response from anthropic");
      expect(p1.generate).toHaveBeenCalledTimes(1);
      expect(p2.generate).toHaveBeenCalledTimes(1);
    });

    it("falls through to third provider when first two fail", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(new Error("error 1")),
      });
      const p2 = createMockProvider("anthropic", {
        generate: vi.fn().mockRejectedValue(new Error("error 2")),
      });
      const p3 = createMockProvider("ollama");
      const fb = new FallbackProvider([p1, p2, p3]);

      const result = await fb.generate({ prompt: "test" });
      expect(result.content).toBe("response from ollama");
      expect(p1.generate).toHaveBeenCalledTimes(1);
      expect(p2.generate).toHaveBeenCalledTimes(1);
      expect(p3.generate).toHaveBeenCalledTimes(1);
    });

    it("throws last error when all providers fail", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(new Error("error 1")),
      });
      const p2 = createMockProvider("anthropic", {
        generate: vi.fn().mockRejectedValue(new Error("error 2")),
      });
      const fb = new FallbackProvider([p1, p2]);

      await expect(fb.generate({ prompt: "test" })).rejects.toThrow("error 2");
    });

    it("throws 'All providers failed' when lastError is undefined", async () => {
      // A provider that rejects with undefined (edge case)
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(undefined),
      });
      const fb = new FallbackProvider([p1]);

      await expect(fb.generate({ prompt: "test" })).rejects.toThrow("All providers failed");
    });

    it("passes request unchanged to each provider", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(new Error("fail")),
      });
      const p2 = createMockProvider("anthropic");
      const fb = new FallbackProvider([p1, p2]);

      const request = { prompt: "hello", system: "you are a bot", temperature: 0.7 };
      await fb.generate(request);

      expect(p1.generate).toHaveBeenCalledWith(request);
      expect(p2.generate).toHaveBeenCalledWith(request);
    });

    it("does not call subsequent providers after first success", async () => {
      const p1 = createMockProvider("openai");
      const p2 = createMockProvider("anthropic");
      const p3 = createMockProvider("ollama");
      const fb = new FallbackProvider([p1, p2, p3]);

      await fb.generate({ prompt: "test" });
      expect(p1.generate).toHaveBeenCalledTimes(1);
      expect(p2.generate).not.toHaveBeenCalled();
      expect(p3.generate).not.toHaveBeenCalled();
    });

    it("preserves full LLMResponse (content, parsed, usage)", async () => {
      const fullResponse: LLMResponse = {
        content: '{"key":"value"}',
        parsed: { key: "value" },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockResolvedValue(fullResponse),
      });
      const fb = new FallbackProvider([p1]);

      const result = await fb.generate({ prompt: "test" });
      expect(result).toEqual(fullResponse);
    });

    it("handles provider throwing synchronous error", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn(() => {
          throw new Error("sync error");
        }),
      });
      const p2 = createMockProvider("anthropic");
      const fb = new FallbackProvider([p1, p2]);

      const result = await fb.generate({ prompt: "test" });
      expect(result.content).toBe("response from anthropic");
    });

    it("works with single provider that succeeds", async () => {
      const p1 = createMockProvider("openai");
      const fb = new FallbackProvider([p1]);

      const result = await fb.generate({ prompt: "test" });
      expect(result.content).toBe("response from openai");
    });

    it("works with single provider that fails", async () => {
      const p1 = createMockProvider("openai", {
        generate: vi.fn().mockRejectedValue(new Error("only provider failed")),
      });
      const fb = new FallbackProvider([p1]);

      await expect(fb.generate({ prompt: "test" })).rejects.toThrow("only provider failed");
    });
  });

  describe("listModels()", () => {
    it("returns models from first provider with listModels()", async () => {
      const p1 = createMockProvider("openai", {
        listModels: vi.fn().mockResolvedValue(["gpt-4", "gpt-3.5"]),
      });
      const p2 = createMockProvider("anthropic", {
        listModels: vi.fn().mockResolvedValue(["claude-3"]),
      });
      const fb = new FallbackProvider([p1, p2]);

      const models = await fb.listModels();
      expect(models).toEqual(["gpt-4", "gpt-3.5"]);
      expect(p1.listModels).toHaveBeenCalled();
      expect(p2.listModels).not.toHaveBeenCalled();
    });

    it("falls through when first provider has no listModels", async () => {
      const p1: LLMProvider = {
        name: "basic",
        generate: vi.fn(async () => ({ content: "ok" })),
      };
      const p2 = createMockProvider("anthropic", {
        listModels: vi.fn().mockResolvedValue(["claude-3"]),
      });
      const fb = new FallbackProvider([p1, p2]);

      const models = await fb.listModels();
      expect(models).toEqual(["claude-3"]);
    });

    it("falls through when first provider's listModels throws", async () => {
      const p1 = createMockProvider("openai", {
        listModels: vi.fn().mockRejectedValue(new Error("API error")),
      });
      const p2 = createMockProvider("anthropic", {
        listModels: vi.fn().mockResolvedValue(["claude-3"]),
      });
      const fb = new FallbackProvider([p1, p2]);

      const models = await fb.listModels();
      expect(models).toEqual(["claude-3"]);
    });

    it("returns empty array when no provider has listModels", async () => {
      const p1: LLMProvider = {
        name: "basic1",
        generate: vi.fn(async () => ({ content: "ok" })),
      };
      const p2: LLMProvider = {
        name: "basic2",
        generate: vi.fn(async () => ({ content: "ok" })),
      };
      const fb = new FallbackProvider([p1, p2]);

      const models = await fb.listModels();
      expect(models).toEqual([]);
    });

    it("returns empty array when all listModels calls fail", async () => {
      const p1 = createMockProvider("openai", {
        listModels: vi.fn().mockRejectedValue(new Error("fail 1")),
      });
      const p2 = createMockProvider("anthropic", {
        listModels: vi.fn().mockRejectedValue(new Error("fail 2")),
      });
      const fb = new FallbackProvider([p1, p2]);

      const models = await fb.listModels();
      expect(models).toEqual([]);
    });

    it("does not call subsequent after first successful listModels", async () => {
      const p1 = createMockProvider("openai", {
        listModels: vi.fn().mockResolvedValue(["gpt-4"]),
      });
      const p2 = createMockProvider("anthropic", {
        listModels: vi.fn().mockResolvedValue(["claude-3"]),
      });
      const fb = new FallbackProvider([p1, p2]);

      await fb.listModels();
      expect(p1.listModels).toHaveBeenCalledTimes(1);
      expect(p2.listModels).not.toHaveBeenCalled();
    });
  });
});
