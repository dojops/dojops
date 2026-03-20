import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../session";
import { LLMProvider, AgentRouter } from "@dojops/core";

function createMockProvider(name: string, response = "Mock response"): LLMProvider {
  return {
    name,
    generate: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe("ChatSession provider switching", () => {
  it("setProvider + setRouter swaps provider while preserving messages", async () => {
    const provider1 = createMockProvider("openai", "OpenAI response");
    const router1 = new AgentRouter(provider1);
    const session = new ChatSession({ provider: provider1, router: router1 });

    // Send a message with provider1
    await session.send("Hello from provider 1");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[1].content).toBe("OpenAI response");

    // Switch to provider2 (provider + router — agents hold provider reference)
    const provider2 = createMockProvider("anthropic", "Anthropic response");
    const router2 = new AgentRouter(provider2);
    session.setProvider(provider2);
    session.setRouter(router2);

    // Send a message with provider2 — history is preserved
    await session.send("Hello from provider 2");
    expect(session.messages).toHaveLength(4);
    expect(session.messages[3].content).toBe("Anthropic response");

    // Verify provider2 was called (routing + generation for the second message)
    expect(provider2.generate).toHaveBeenCalled();
  });

  it("setRouter swaps the router and unpins the agent", () => {
    const provider = createMockProvider("openai");
    const router1 = new AgentRouter(provider);
    const session = new ChatSession({ provider, router: router1 });

    // Pin an agent
    session.pinAgent("terraform");
    expect(session.getState().pinnedAgent).toBe("terraform-specialist");

    // Switch router
    const router2 = new AgentRouter(provider);
    session.setRouter(router2);

    // Agent should be unpinned (old agent may not exist in new router)
    expect(session.getState().pinnedAgent).toBeUndefined();
  });

  it("setProvider updates the summarizer to use the new provider", async () => {
    const provider1 = createMockProvider("openai", "response");
    const router1 = new AgentRouter(provider1);
    const session = new ChatSession({
      provider: provider1,
      router: router1,
      maxContextMessages: 4,
    });
    session.pinAgent("ops-cortex");

    // Fill up messages to trigger summarization
    await session.send("msg1");
    await session.send("msg2");
    await session.send("msg3");

    // Switch provider + router before summarization triggers
    const provider2: LLMProvider = {
      name: "anthropic",
      generate: vi
        .fn()
        .mockResolvedValueOnce({ content: "summary" }) // summarizer call
        .mockResolvedValueOnce({ content: "anthropic response" }), // agent call
    };
    const router2 = new AgentRouter(provider2);
    session.setProvider(provider2);
    session.setRouter(router2);
    session.pinAgent("ops-cortex"); // re-pin since setRouter unpins

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 4th send triggers summarization — should use provider2
    const result = await session.send("msg4");
    expect(result.content).toBe("anthropic response");
    expect(provider2.generate).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("message format is provider-agnostic", async () => {
    const provider = createMockProvider("openai", "response");
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    await session.send("Test message");

    const msgs = session.messages;
    // Messages only use {role, content, timestamp} — no provider-specific fields
    for (const msg of msgs) {
      expect(Object.keys(msg).sort((a, b) => a.localeCompare(b))).toEqual([
        "content",
        "role",
        "timestamp",
      ]);
    }
  });
});
