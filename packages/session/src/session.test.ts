import { describe, it, expect, vi } from "vitest";
import { ChatSession } from "./session";
import { LLMProvider, AgentRouter } from "@dojops/core";
import { ChatSessionState } from "./types";

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
    expect(state.pinnedAgent).toBe("terraform");
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
});
