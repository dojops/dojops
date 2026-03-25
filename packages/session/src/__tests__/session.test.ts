import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../session";
import { LLMProvider, AgentRouter } from "@dojops/core";
import { ChatSessionState } from "../types";

function createMockProvider(response = "Mock response"): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({ content: response }),
  };
}

function createTestSession(opts?: { response?: string; state?: ChatSessionState }) {
  const provider = createMockProvider(opts?.response ?? "Mock response");
  const router = new AgentRouter(provider);
  return { provider, router, session: new ChatSession({ provider, router, state: opts?.state }) };
}

describe("ChatSession", () => {
  it("creates with default state", () => {
    const { session } = createTestSession();
    expect(session.id).toMatch(/^chat-/);
    expect(session.messages).toHaveLength(0);
    expect(session.mode).toBe("INTERACTIVE");
  });

  it("creates with provided state", () => {
    const state: ChatSessionState = {
      id: "chat-test123",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "DETERMINISTIC",
      messages: [],
      metadata: { totalTokensEstimate: 0, messageCount: 0 },
    };
    const { session } = createTestSession({ state });
    expect(session.id).toBe("chat-test123");
    expect(session.mode).toBe("DETERMINISTIC");
  });

  it("send() adds messages to history and returns response", async () => {
    const { session } = createTestSession({ response: "Here is a Terraform config." });
    const result = await session.send("Create a Terraform config for S3");

    expect(result.content).toBe("Here is a Terraform config.");
    expect(result.agent).toBeTruthy();
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe("Create a Terraform config for S3");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[1].content).toBe("Here is a Terraform config.");
  });

  it("send() updates metadata", async () => {
    const { session } = createTestSession();
    await session.send("Hello");
    const state = session.getState();
    expect(state.metadata.messageCount).toBe(2);
    expect(state.metadata.totalTokensEstimate).toBeGreaterThan(0);
    expect(state.metadata.lastAgentUsed).toBeTruthy();
  });

  it("pinAgent routes to pinned agent", () => {
    const { session } = createTestSession();
    session.pinAgent("terraform");
    const state = session.getState();
    // pinAgent resolves partial names to full agent names (e.g. "terraform" → "terraform-specialist")
    expect(state.pinnedAgent).toBe("terraform-specialist");
  });

  it("unpinAgent clears pinned agent", () => {
    const { session } = createTestSession();
    session.pinAgent("terraform");
    session.unpinAgent();
    const state = session.getState();
    expect(state.pinnedAgent).toBeUndefined();
  });

  it("clearMessages resets session messages", async () => {
    const { session } = createTestSession();
    await session.send("Hello");
    expect(session.messages.length).toBeGreaterThan(0);
    session.clearMessages();
    expect(session.messages).toHaveLength(0);
    const state = session.getState();
    expect(state.metadata.messageCount).toBe(0);
  });

  it("getState returns a copy of state", () => {
    const { session } = createTestSession();
    const state1 = session.getState();
    const state2 = session.getState();
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2);
  });

  describe("bridge commands", () => {
    it("detects /plan command", async () => {
      const { session } = createTestSession();
      const result = await session.send("/plan Deploy ECS cluster");
      expect(result.agent).toBe("bridge");
      expect(result.content).toBe("__bridge__:plan:Deploy ECS cluster");
    });

    it("detects /apply command", async () => {
      const { session } = createTestSession();
      const result = await session.send("/apply");
      expect(result.agent).toBe("bridge");
      expect(result.content).toBe("__bridge__:apply:");
    });

    it("detects /scan command", async () => {
      const { session } = createTestSession();
      const result = await session.send("/scan");
      expect(result.agent).toBe("bridge");
      expect(result.content).toBe("__bridge__:scan:");
    });

    it("does not detect regular messages as bridge commands", async () => {
      const { session } = createTestSession();
      const result = await session.send("Tell me about plans");
      expect(result.agent).not.toBe("bridge");
    });
  });

  describe("compress()", () => {
    it("returns null when fewer than 4 messages", async () => {
      const { session } = createTestSession();
      // Add 2 messages via send (user + assistant = 2 messages)
      await session.send("Hello");
      expect(session.messages).toHaveLength(2);

      const result = await session.compress();
      expect(result).toBeNull();
    });

    it("returns null with exactly 3 messages", async () => {
      const state: ChatSessionState = {
        id: "chat-compress-3",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        mode: "INTERACTIVE",
        messages: [
          { role: "user", content: "msg1", timestamp: "2024-01-01T00:00:01.000Z" },
          { role: "assistant", content: "reply1", timestamp: "2024-01-01T00:00:02.000Z" },
          { role: "user", content: "msg2", timestamp: "2024-01-01T00:00:03.000Z" },
        ],
        metadata: { totalTokensEstimate: 0, messageCount: 3 },
      };
      const { session } = createTestSession({ state });

      const result = await session.compress();
      expect(result).toBeNull();
    });

    it("returns summarization info when >= 4 messages", async () => {
      const provider: LLMProvider = {
        name: "mock",
        generate: vi
          .fn()
          // First 2 calls for send() agent calls
          .mockResolvedValueOnce({ content: "response1" })
          .mockResolvedValueOnce({ content: "response2" })
          // 3rd call for summarizer.summarize()
          .mockResolvedValueOnce({ content: "Summary of conversation" }),
      };
      const router = new AgentRouter(provider);
      const session = new ChatSession({ provider, router });
      session.pinAgent("ops-cortex");

      await session.send("msg1");
      await session.send("msg2");
      // Now we have 4 messages (2 user + 2 assistant)
      expect(session.messages).toHaveLength(4);

      const result = await session.compress();

      expect(result).not.toBeNull();
      expect(result!.messagesRetained).toBe(4);
      expect(result!.messagesSummarized).toBe(0);
    });

    it("summarizes old messages and retains recent ones with 6+ messages", async () => {
      const provider: LLMProvider = {
        name: "mock",
        generate: vi
          .fn()
          // 3 send() agent calls
          .mockResolvedValueOnce({ content: "r1" })
          .mockResolvedValueOnce({ content: "r2" })
          .mockResolvedValueOnce({ content: "r3" })
          // compress() summarizer call
          .mockResolvedValueOnce({ content: "Conversation summary" }),
      };
      const router = new AgentRouter(provider);
      const session = new ChatSession({ provider, router });
      session.pinAgent("ops-cortex");

      await session.send("m1");
      await session.send("m2");
      await session.send("m3");
      // 6 messages total
      expect(session.messages).toHaveLength(6);

      const result = await session.compress();

      expect(result).not.toBeNull();
      expect(result!.messagesRetained).toBe(4);
      expect(result!.messagesSummarized).toBe(2);
      // Session should now have only 4 messages
      expect(session.messages).toHaveLength(4);
    });

    it("updates session metadata after compression", async () => {
      // Pre-build state with an old updatedAt to avoid same-millisecond race
      const state: ChatSessionState = {
        id: "chat-compress-meta",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        mode: "INTERACTIVE",
        messages: [
          { role: "user", content: "m1", timestamp: "2024-01-01T00:00:01.000Z" },
          { role: "assistant", content: "r1", timestamp: "2024-01-01T00:00:02.000Z" },
          { role: "user", content: "m2", timestamp: "2024-01-01T00:00:03.000Z" },
          { role: "assistant", content: "r2", timestamp: "2024-01-01T00:00:04.000Z" },
          { role: "user", content: "m3", timestamp: "2024-01-01T00:00:05.000Z" },
          { role: "assistant", content: "r3", timestamp: "2024-01-01T00:00:06.000Z" },
        ],
        metadata: { totalTokensEstimate: 100, messageCount: 6 },
      };
      const provider: LLMProvider = {
        name: "mock",
        generate: vi.fn().mockResolvedValueOnce({ content: "Summary text" }),
      };
      const router = new AgentRouter(provider);
      const session = new ChatSession({ provider, router, state });

      await session.compress();

      const stateAfter = session.getState();
      expect(stateAfter.metadata.messageCount).toBe(4);
      expect(stateAfter.summary).toBe("Summary text");
      // updatedAt should be updated from the old 2024 value
      expect(stateAfter.updatedAt).not.toBe("2024-01-01T00:00:00.000Z");
      expect(stateAfter.metadata.totalTokensEstimate).toBeGreaterThanOrEqual(0);
    });
  });

  describe("summarization edge cases", () => {
    it("continues when summarization fails", async () => {
      // With maxContextMessages: 4, summarization triggers when messageCount > floor(4 * 1.5) = 6.
      // Each send() adds 2 messages (user + assistant).
      // After 3 sends: 6 messages. On 4th send: user message pushed first -> 7 messages -> triggers summarization.
      // Mock sequence:
      //   1. generate() for send #1 agent call -> succeeds
      //   2. generate() for send #2 agent call -> succeeds
      //   3. generate() for send #3 agent call -> succeeds
      //   4. generate() for summarizer call -> fails (summarization)
      //   5. generate() for send #4 agent call -> succeeds
      const provider: LLMProvider = {
        name: "mock",
        generate: vi
          .fn()
          .mockResolvedValueOnce({ content: "response1" })
          .mockResolvedValueOnce({ content: "response2" })
          .mockResolvedValueOnce({ content: "response3" })
          .mockRejectedValueOnce(new Error("LLM unavailable"))
          .mockResolvedValueOnce({ content: "response4" }),
      };

      const router = new AgentRouter(provider);
      const session = new ChatSession({ provider, router, maxContextMessages: 4 });
      // Pin agent to skip LLM routing (this test is about summarization, not routing)
      session.pinAgent("ops-cortex");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await session.send("msg1");
      await session.send("msg2");
      await session.send("msg3");

      // 4th send triggers summarization (7 > 6), which fails, then continues with agent call
      const result = await session.send("msg4");

      expect(result.content).toBe("response4");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("summarization failed"),
        expect.any(String),
      );

      warnSpy.mockRestore();
    });

    it("getState returns shallow copy - messages array is shared", () => {
      // getState() uses spread operator { ...this.state } which is a shallow copy.
      // The messages array reference inside is the same object.
      const provider = createMockProvider();
      const router = new AgentRouter(provider);
      const state: ChatSessionState = {
        id: "chat-shallow",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        mode: "INTERACTIVE",
        messages: [{ role: "user", content: "hello", timestamp: "2024-01-01T00:00:01.000Z" }],
        metadata: { totalTokensEstimate: 0, messageCount: 1 },
      };
      const session = new ChatSession({ provider, router, state });

      const copy = session.getState();

      // Top-level object is different (shallow copy)
      expect(copy).not.toBe(state);
      // Messages array is deep-copied (A15: prevent external mutation)
      expect(copy.messages).not.toBe(session.messages);
      expect(copy.messages).toStrictEqual(session.messages);
    });
  });

  describe("no-provider mode", () => {
    it("constructs without provider or router", () => {
      const session = new ChatSession({});
      expect(session.id).toMatch(/^chat-/);
      expect(session.messages).toHaveLength(0);
      expect(session.hasProvider()).toBe(false);
    });

    it("hasProvider returns true when provider and router are set", () => {
      const { session } = createTestSession();
      expect(session.hasProvider()).toBe(true);
    });

    it("send() throws helpful error without provider", async () => {
      const session = new ChatSession({});
      await expect(session.send("Hello")).rejects.toThrow(/No LLM provider configured/);
    });

    it("sendStream() throws helpful error without provider", async () => {
      const session = new ChatSession({});
      await expect(session.sendStream("Hello", () => {})).rejects.toThrow(
        /No LLM provider configured/,
      );
    });

    it("compress() throws helpful error without provider", async () => {
      const state: ChatSessionState = {
        id: "chat-no-provider",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        mode: "INTERACTIVE",
        messages: [
          { role: "user", content: "m1", timestamp: "2024-01-01T00:00:01.000Z" },
          { role: "assistant", content: "r1", timestamp: "2024-01-01T00:00:02.000Z" },
          { role: "user", content: "m2", timestamp: "2024-01-01T00:00:03.000Z" },
          { role: "assistant", content: "r2", timestamp: "2024-01-01T00:00:04.000Z" },
        ],
        metadata: { totalTokensEstimate: 0, messageCount: 4 },
      };
      const session = new ChatSession({ state });
      await expect(session.compress()).rejects.toThrow(/No LLM provider configured/);
    });

    it("pinAgent() throws helpful error without router", () => {
      const session = new ChatSession({});
      expect(() => session.pinAgent("terraform")).toThrow(/No LLM provider configured/);
    });

    it("setProvider() activates the session", () => {
      const session = new ChatSession({});
      expect(session.hasProvider()).toBe(false);

      const provider = createMockProvider();
      const router = new AgentRouter(provider);
      session.setProvider(provider);
      session.setRouter(router);
      expect(session.hasProvider()).toBe(true);
    });

    it("local operations work without provider", () => {
      const session = new ChatSession({});
      // These should all work without a provider
      session.clearMessages();
      session.setName("test-session");
      session.unpinAgent();
      const state = session.getState();
      expect(state.name).toBe("test-session");
      expect(state.messages).toHaveLength(0);
    });
  });
});
