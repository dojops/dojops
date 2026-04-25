import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../session";
import { LLMProvider, AgentRouter } from "@dojops/core";
import { SessionSummarizer } from "../summarizer";
import { rewindMessages, getTurnCount } from "../rewind";
import { ChatMessage, ChatSessionState } from "../types";

function createMockProvider(response = "Mock response"): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({ content: response }),
  };
}

function createTestSession(opts?: {
  response?: string;
  state?: ChatSessionState;
  maxContextMessages?: number;
  projectDomains?: string[];
}) {
  const provider = createMockProvider(opts?.response ?? "Mock response");
  const router = new AgentRouter(provider);
  return {
    provider,
    router,
    session: new ChatSession({
      provider,
      router,
      state: opts?.state,
      maxContextMessages: opts?.maxContextMessages,
      projectDomains: opts?.projectDomains,
    }),
  };
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: new Date().toISOString() };
}

// ── Multi-turn conversation pipeline ───────────────────────────────

describe("Session pipeline — multi-turn conversation", () => {
  it("maintains ordered message history across turns", async () => {
    const { session } = createTestSession({ response: "reply" });

    await session.send("First question");
    await session.send("Follow-up");

    expect(session.messages).toHaveLength(4);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[0].content).toBe("First question");
    expect(session.messages[1].role).toBe("assistant");
    expect(session.messages[2].role).toBe("user");
    expect(session.messages[2].content).toBe("Follow-up");
    expect(session.messages[3].role).toBe("assistant");
  });

  it("routes each message to an agent and returns agent name", async () => {
    const { session } = createTestSession({ response: "terraform config here" });
    const result = await session.send("Create a Terraform config for VPC");

    expect(result.agent).toBeTruthy();
    expect(typeof result.agent).toBe("string");
    expect(result.content).toBe("terraform config here");
  });

  it("tracks session token estimates across turns", async () => {
    const { session } = createTestSession();
    await session.send("msg1");
    const state1 = session.getState();
    const tokens1 = state1.metadata.totalTokensEstimate;

    await session.send("msg2");
    const state2 = session.getState();

    expect(state2.metadata.totalTokensEstimate).toBeGreaterThan(tokens1);
    expect(state2.metadata.messageCount).toBe(4);
  });

  it("returns per-turn session token count in SendResult", async () => {
    const { session } = createTestSession();
    const result = await session.send("Hello");

    expect(result.sessionTokens).toBeGreaterThanOrEqual(0);
    expect(typeof result.sessionTokens).toBe("number");
  });
});

// ── Agent pinning pipeline ─────────────────────────────────────────

describe("Session pipeline — agent pinning", () => {
  it("routes all messages to pinned agent", async () => {
    const { session, provider } = createTestSession();
    session.pinAgent("terraform");

    await session.send("How do I set up S3?");
    await session.send("And what about DynamoDB?");

    const generate = vi.mocked(provider.generate);
    const call1System = (generate.mock.calls[0][0].system ?? "").toLowerCase();
    const call2System = (generate.mock.calls[1][0].system ?? "").toLowerCase();
    expect(call1System).toContain("terraform");
    expect(call2System).toContain("terraform");
  });

  it("unpinAgent resumes normal routing", async () => {
    const { session } = createTestSession();
    session.pinAgent("terraform");
    expect(session.getState().pinnedAgent).toBe("terraform-specialist");

    session.unpinAgent();
    expect(session.getState().pinnedAgent).toBeUndefined();
  });
});

// ── Bridge commands pipeline ───────────────────────────────────────

describe("Session pipeline — bridge commands", () => {
  it("/plan returns bridge marker with goal", async () => {
    const { session } = createTestSession();
    const result = await session.send("/plan Create CI for Node.js");

    expect(result.agent).toBe("bridge");
    expect(result.content).toBe("__bridge__:plan:Create CI for Node.js");
  });

  it("/apply returns bridge marker", async () => {
    const { session } = createTestSession();
    const result = await session.send("/apply");

    expect(result.agent).toBe("bridge");
    expect(result.content).toBe("__bridge__:apply:");
  });

  it("/scan returns bridge marker", async () => {
    const { session } = createTestSession();
    const result = await session.send("/scan");

    expect(result.agent).toBe("bridge");
    expect(result.content).toBe("__bridge__:scan:");
  });

  it("regular messages are not bridge commands", async () => {
    const { session } = createTestSession();
    const result = await session.send("Tell me about plans");

    expect(result.agent).not.toBe("bridge");
    expect(result.content).not.toContain("__bridge__");
  });
});

// ── Compression pipeline ───────────────────────────────────────────

describe("Session pipeline — compression and summarization", () => {
  it("does not compress when under message threshold", async () => {
    const { session } = createTestSession();
    await session.send("Hello");
    expect(session.messages).toHaveLength(2);

    const result = await session.compress();
    expect(result).toBeNull();
  });

  it("compresses old messages and retains recent window", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi
        .fn()
        .mockResolvedValueOnce({ content: "r1" })
        .mockResolvedValueOnce({ content: "r2" })
        .mockResolvedValueOnce({ content: "r3" })
        .mockResolvedValueOnce({ content: "Compressed summary" }),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });
    session.pinAgent("ops-cortex");

    await session.send("m1");
    await session.send("m2");
    await session.send("m3");
    expect(session.messages).toHaveLength(6);

    const result = await session.compress();
    expect(result).not.toBeNull();
    expect(result!.messagesRetained).toBeLessThanOrEqual(6);
  });

  it("stores summary in session state after compression", async () => {
    const state: ChatSessionState = {
      id: "chat-summary-test",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "INTERACTIVE",
      messages: [
        msg("user", "m1"),
        msg("assistant", "r1"),
        msg("user", "m2"),
        msg("assistant", "r2"),
        msg("user", "m3"),
        msg("assistant", "r3"),
      ],
      metadata: { totalTokensEstimate: 100, messageCount: 6 },
    };
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValueOnce({ content: "Compressed summary of old messages" }),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state });

    await session.compress();

    const stateAfter = session.getState();
    expect(stateAfter.summary).toBe("Compressed summary of old messages");
    expect(stateAfter.metadata.messageCount).toBeLessThan(6);
  });

  it("continues when summarization LLM call fails", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi
        .fn()
        .mockResolvedValueOnce({ content: "r1" })
        .mockResolvedValueOnce({ content: "r2" })
        .mockResolvedValueOnce({ content: "r3" })
        .mockRejectedValueOnce(new Error("LLM unavailable"))
        .mockResolvedValueOnce({ content: "r4" }),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, maxContextMessages: 4 });
    session.pinAgent("ops-cortex");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await session.send("msg1");
    await session.send("msg2");
    await session.send("msg3");
    const result = await session.send("msg4");

    expect(result.content).toBe("r4");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("summarization failed"),
      expect.any(String),
    );

    warnSpy.mockRestore();
  });
});

// ── Rewind pipeline ───────────────────────────────────────────────

describe("Session pipeline — rewind", () => {
  it("removes last N turn pairs", () => {
    const messages: ChatMessage[] = [
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
      msg("user", "m3"),
      msg("assistant", "r3"),
    ];

    const result = rewindMessages(messages, 2);

    expect(result.removedTurns).toBe(2);
    expect(result.removedMessages).toHaveLength(4);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("m1");
    expect(messages[1].content).toBe("r1");
  });

  it("handles rewind beyond available turns", () => {
    const messages: ChatMessage[] = [msg("user", "only"), msg("assistant", "one")];

    const result = rewindMessages(messages, 5);

    expect(result.removedTurns).toBe(1);
    expect(messages).toHaveLength(0);
  });

  it("preserves system messages during rewind", () => {
    const messages: ChatMessage[] = [
      msg("system", "You are helpful"),
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
    ];

    rewindMessages(messages, 1);

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("m1");
  });

  it("getTurnCount counts user messages only", () => {
    const messages: ChatMessage[] = [
      msg("system", "context"),
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
    ];

    expect(getTurnCount(messages)).toBe(2);
  });

  it("getTurnCount returns 0 for empty array", () => {
    expect(getTurnCount([])).toBe(0);
  });
});

// ── Summarizer pipeline ────────────────────────────────────────────

describe("Session pipeline — summarizer", () => {
  it("calls LLM with structured summarization prompt", async () => {
    const provider = createMockProvider("Summary: discussed terraform and k8s");
    const summarizer = new SessionSummarizer(provider);

    const messages: ChatMessage[] = [
      msg("user", "Create terraform config"),
      msg("assistant", "Here is your terraform config"),
      msg("user", "Now add kubernetes deployment"),
      msg("assistant", "Here is your k8s deployment"),
    ];

    const result = await summarizer.summarize(messages);
    expect(result).toBe("Summary: discussed terraform and k8s");

    const generate = vi.mocked(provider.generate);
    expect(generate).toHaveBeenCalledOnce();
    const call = generate.mock.calls[0][0];
    expect(call.system).toContain("summarizer");
    expect(call.prompt).toContain("terraform");
  });

  it("returns empty string for empty messages — no LLM call", async () => {
    const provider = createMockProvider("should not be called");
    const summarizer = new SessionSummarizer(provider);

    const result = await summarizer.summarize([]);
    expect(result).toBe("");
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

// ── Session state lifecycle ────────────────────────────────────────

describe("Session pipeline — state lifecycle", () => {
  it("initializes with unique id and INTERACTIVE mode", () => {
    const { session } = createTestSession();
    expect(session.id).toMatch(/^chat-/);
    expect(session.mode).toBe("INTERACTIVE");
    expect(session.messages).toHaveLength(0);
  });

  it("restores from provided state", () => {
    const state: ChatSessionState = {
      id: "chat-restored",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "DETERMINISTIC",
      messages: [msg("user", "old"), msg("assistant", "response")],
      metadata: { totalTokensEstimate: 50, messageCount: 2 },
    };
    const { session } = createTestSession({ state });

    expect(session.id).toBe("chat-restored");
    expect(session.mode).toBe("DETERMINISTIC");
    expect(session.messages).toHaveLength(2);
  });

  it("getState returns a copy (not the same reference)", () => {
    const { session } = createTestSession();
    const s1 = session.getState();
    const s2 = session.getState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2);
  });

  it("clearMessages resets message count", async () => {
    const { session } = createTestSession();
    await session.send("Hello");
    expect(session.messages.length).toBeGreaterThan(0);

    session.clearMessages();
    expect(session.messages).toHaveLength(0);
    expect(session.getState().metadata.messageCount).toBe(0);
  });

  it("updates metadata after each send", async () => {
    const { session } = createTestSession();
    await session.send("Hello");

    const state = session.getState();
    expect(state.metadata.messageCount).toBe(2);
    expect(state.metadata.totalTokensEstimate).toBeGreaterThan(0);
    expect(state.metadata.lastAgentUsed).toBeTruthy();
  });

  it("throws when sending without provider", async () => {
    const session = new ChatSession({});
    await expect(session.send("Hello")).rejects.toThrow(/No LLM provider configured/);
  });
});

// ── Domain-biased routing ──────────────────────────────────────────

describe("Session pipeline — domain-biased routing", () => {
  it("accepts projectDomains for routing bias", async () => {
    const { session } = createTestSession({
      response: "terraform output",
      projectDomains: ["terraform", "aws"],
    });

    const result = await session.send("Set up infrastructure");
    expect(result.agent).toBeTruthy();
    expect(result.content).toBe("terraform output");
  });
});
