import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "../session";
import { LLMProvider, AgentRouter } from "@dojops/core";
import type { ChatSessionState, ChatMessage } from "../types";

function mockProvider(response = "Mock response"): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({ content: response }),
  };
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: new Date().toISOString() };
}

// ── Provider failure during send ───────────────────────────────────

describe("Session error recovery — provider failure during send", () => {
  it("propagates LLM error to caller", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockRejectedValue(new Error("API key invalid")),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    await expect(session.send("Hello")).rejects.toThrow("API key invalid");
  });

  it("rolls back user message on non-transient LLM error and re-throws", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockImplementation(async () => {
        callCount++;
        // Non-transient error (won't be retried by executeWithRetry)
        if (callCount === 1) throw new Error("Invalid API key");
        return { content: "recovery" };
      }),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });
    session.pinAgent("ops-cortex");

    await expect(session.send("msg1")).rejects.toThrow("Invalid API key");
    // User message rolled back on failure
    expect(session.messages).toHaveLength(0);

    // Session still works after failure
    const result = await session.send("msg2");
    expect(result.content).toBe("recovery");
  });

  it("recovers on next send after transient failure", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi
        .fn()
        .mockRejectedValueOnce(new Error("Transient failure"))
        .mockResolvedValueOnce({ content: "Recovered response" }),
    };
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });
    session.pinAgent("ops-cortex");

    try {
      await session.send("msg1");
    } catch {
      // expected
    }

    const result = await session.send("msg2");
    expect(result.content).toBe("Recovered response");
  });
});

// ── No provider configured ─────────────────────────────────────────

describe("Session error recovery — no provider", () => {
  it("throws descriptive error when sending without provider", async () => {
    const session = new ChatSession({});
    await expect(session.send("Hello")).rejects.toThrow(/No LLM provider configured/);
  });

  it("throws when only provider is set but no router", async () => {
    const session = new ChatSession({ provider: mockProvider() });
    await expect(session.send("Hello")).rejects.toThrow(/No LLM provider configured/);
  });

  it("hasProvider returns false when provider is missing", () => {
    const session = new ChatSession({});
    expect(session.hasProvider()).toBe(false);
  });

  it("hasProvider returns true when both provider and router are set", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });
    expect(session.hasProvider()).toBe(true);
  });
});

// ── State restoration edge cases ───────────────────────────────────

describe("Session error recovery — state restoration", () => {
  it("restores session with existing messages", () => {
    const state: ChatSessionState = {
      id: "chat-restore-1",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      mode: "INTERACTIVE",
      messages: [
        msg("user", "old message 1"),
        msg("assistant", "old reply 1"),
        msg("user", "old message 2"),
        msg("assistant", "old reply 2"),
      ],
      metadata: { totalTokensEstimate: 50, messageCount: 4 },
    };

    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state });

    expect(session.messages).toHaveLength(4);
    expect(session.id).toBe("chat-restore-1");
  });

  it("restores session with summary", () => {
    const state: ChatSessionState = {
      id: "chat-restore-summary",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      mode: "INTERACTIVE",
      messages: [msg("user", "recent"), msg("assistant", "reply")],
      metadata: { totalTokensEstimate: 30, messageCount: 2 },
      summary: "Previous conversation was about terraform configs",
    };

    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state });

    expect(session.getState().summary).toBe("Previous conversation was about terraform configs");
  });

  it("restores session with pinned agent", () => {
    const state: ChatSessionState = {
      id: "chat-restore-pinned",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "INTERACTIVE",
      messages: [],
      metadata: { totalTokensEstimate: 0, messageCount: 0 },
      pinnedAgent: "terraform-specialist",
    };

    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state });

    expect(session.getState().pinnedAgent).toBe("terraform-specialist");
  });

  it("continues conversation after restoring state", async () => {
    const state: ChatSessionState = {
      id: "chat-continue",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "INTERACTIVE",
      messages: [msg("user", "initial"), msg("assistant", "initial reply")],
      metadata: { totalTokensEstimate: 20, messageCount: 2 },
    };

    const provider = mockProvider("Follow-up response");
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state });

    const result = await session.send("Follow-up question");
    expect(result.content).toBe("Follow-up response");
    expect(session.messages).toHaveLength(4);
  });
});

// ── clearMessages edge cases ───────────────────────────────────────

describe("Session error recovery — clearMessages", () => {
  it("clearMessages on empty session is safe", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    session.clearMessages();
    expect(session.messages).toHaveLength(0);
    expect(session.getState().metadata.messageCount).toBe(0);
  });

  it("can send after clearMessages", async () => {
    const provider = mockProvider("Post-clear response");
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    await session.send("Before clear");
    session.clearMessages();

    const result = await session.send("After clear");
    expect(result.content).toBe("Post-clear response");
    expect(session.messages).toHaveLength(2);
  });
});

// ── Agent pinning edge cases ───────────────────────────────────────

describe("Session error recovery — agent pinning edge cases", () => {
  it("pinAgent throws for unknown agent name", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    expect(() => session.pinAgent("nonexistent-agent")).toThrow(/Unknown agent/);
  });

  it("pinAgent resolves partial name to full agent name", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    session.pinAgent("terraform");
    expect(session.getState().pinnedAgent).toBe("terraform-specialist");
  });

  it("unpinAgent is idempotent", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    session.unpinAgent();
    session.unpinAgent();
    expect(session.getState().pinnedAgent).toBeUndefined();
  });

  it("pin then unpin then pin works", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });

    session.pinAgent("terraform");
    expect(session.getState().pinnedAgent).toBe("terraform-specialist");

    session.unpinAgent();
    expect(session.getState().pinnedAgent).toBeUndefined();

    session.pinAgent("kubernetes");
    expect(session.getState().pinnedAgent).toBe("kubernetes-specialist");
  });
});

// ── Mode handling ──────────────────────────────────────────────────

describe("Session error recovery — mode handling", () => {
  it("defaults to INTERACTIVE mode", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router });
    expect(session.mode).toBe("INTERACTIVE");
  });

  it("respects DETERMINISTIC mode from options", () => {
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, mode: "DETERMINISTIC" });
    expect(session.mode).toBe("DETERMINISTIC");
  });

  it("respects mode from restored state over options", () => {
    const state: ChatSessionState = {
      id: "chat-mode",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      mode: "DETERMINISTIC",
      messages: [],
      metadata: { totalTokensEstimate: 0, messageCount: 0 },
    };
    const provider = mockProvider();
    const router = new AgentRouter(provider);
    const session = new ChatSession({ provider, router, state, mode: "INTERACTIVE" });

    // State takes precedence
    expect(session.mode).toBe("DETERMINISTIC");
  });
});
