import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../agent-loop";
import type {
  LLMProvider,
  LLMToolResponse,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from "@dojops/core";
import { DONE_TOOL, READ_FILE_TOOL } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";

/** Create a mock LLMProvider with generateWithTools. */
function mockProvider(responses: LLMToolResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "test-provider",
    generate: vi.fn(),
    generateWithTools: vi.fn(async () => {
      const response = responses[callIndex];
      if (!response) throw new Error(`No mock response at index ${callIndex}`);
      callIndex++;
      return response;
    }),
  };
}

/** Create a mock ToolExecutor. */
function mockToolExecutor(results?: Map<string, string>): ToolExecutor {
  return {
    execute: vi.fn(async (call: ToolCall): Promise<ToolResult> => {
      const output = results?.get(call.name) ?? `Executed ${call.name}`;
      return { callId: call.id, output };
    }),
    getFilesWritten: vi.fn(() => []),
    getFilesModified: vi.fn(() => []),
  } as unknown as ToolExecutor;
}

describe("AgentLoop", () => {
  const tools: ToolDefinition[] = [READ_FILE_TOOL, DONE_TOOL];

  it("completes on done tool call", async () => {
    const provider = mockProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "done", arguments: { summary: "All done!" } }],
        stopReason: "tool_use",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test system prompt",
    });

    const result = await loop.run("Do something");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("All done!");
    expect(result.iterations).toBe(1);
  });

  it("re-prompts when first response has no tool calls, then completes", async () => {
    const provider = mockProvider([
      // First response: LLM dumps text without using tools
      {
        content: "Here is a Helm chart...",
        toolCalls: [],
        stopReason: "end_turn",
      },
      // After nudge: LLM uses tools properly
      {
        content: "",
        toolCalls: [{ id: "c1", name: "done", arguments: { summary: "Created files." } }],
        stopReason: "tool_use",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Task");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("Created files.");
    expect(result.iterations).toBe(2);
  });

  it("completes on end_turn with no tool calls after tools were already used", async () => {
    const provider = mockProvider([
      // First: use a tool
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "x.ts" } }],
        stopReason: "tool_use",
      },
      // Second: end_turn with summary text, no more tool calls
      {
        content: "I finished the task.",
        toolCalls: [],
        stopReason: "end_turn",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Task");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("I finished the task.");
  });

  it("executes tool calls and continues loop", async () => {
    const provider = mockProvider([
      // First iteration: call read_file
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "test.ts" } }],
        stopReason: "tool_use",
      },
      // Second iteration: call done
      {
        content: "",
        toolCalls: [{ id: "c2", name: "done", arguments: { summary: "Read and done." } }],
        stopReason: "tool_use",
      },
    ]);

    const toolExecutor = mockToolExecutor(new Map([["read_file", "file contents here"]]));
    const loop = new AgentLoop({
      provider,
      toolExecutor,
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Read a file");
    expect(result.success).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[1].name).toBe("done");
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1); // done is not executed via toolExecutor
  });

  it("respects maxIterations", async () => {
    // Provider always returns a tool call (never done)
    const provider = mockProvider(
      new Array(5).fill({
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "x.ts" } }],
        stopReason: "tool_use",
      }),
    );

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
      maxIterations: 3,
    });

    const result = await loop.run("Keep going");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("maximum iterations");
    expect(result.iterations).toBe(3);
  });

  it("respects maxTotalTokens", async () => {
    const provider = mockProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "x.ts" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 100_000, completionTokens: 100_001, totalTokens: 200_001 },
      },
      // Should not be reached
      {
        content: "",
        toolCalls: [{ id: "c2", name: "done", arguments: { summary: "done" } }],
        stopReason: "tool_use",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
      maxTotalTokens: 200_000,
    });

    const result = await loop.run("Expensive task");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("token budget");
  });

  it("handles max_tokens stop reason", async () => {
    const provider = mockProvider([
      {
        content: "Truncated resp",
        toolCalls: [],
        stopReason: "max_tokens",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Task");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("max tokens");
  });

  it("calls callbacks during execution", async () => {
    const onIteration = vi.fn();
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const onThinking = vi.fn();

    const provider = mockProvider([
      {
        content: "Thinking about it...",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }],
        stopReason: "tool_use",
      },
      {
        content: "",
        toolCalls: [{ id: "c2", name: "done", arguments: { summary: "ok" } }],
        stopReason: "tool_use",
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
      onIteration,
      onToolCall,
      onToolResult,
      onThinking,
    });

    await loop.run("Task");
    expect(onIteration).toHaveBeenCalled();
    expect(onToolCall).toHaveBeenCalledTimes(1); // Only read_file, done is caught before dispatch
    expect(onToolResult).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("Thinking about it...");
  });

  it("tracks token usage across iterations", async () => {
    const provider = mockProvider([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      {
        content: "",
        toolCalls: [{ id: "c2", name: "done", arguments: { summary: "done" } }],
        stopReason: "tool_use",
        usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
      },
    ]);

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Task");
    expect(result.totalTokens).toBe(430); // 150 + 280
  });

  it("falls back to prompt-based tool calling when generateWithTools is absent", async () => {
    // Provider without generateWithTools
    const provider: LLMProvider = {
      name: "no-tools-provider",
      generate: vi.fn(async () => ({
        content: '{"tool_calls": [{"name": "done", "arguments": {"summary": "Fallback works"}}]}',
      })),
    };

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Fallback test");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("Fallback works");
    expect(provider.generate).toHaveBeenCalled();
  });

  it("extracts summary from truncated JSON (missing closing brace)", async () => {
    const provider: LLMProvider = {
      name: "truncated-json-provider",
      generate: vi.fn(async () => ({
        content:
          '{"tool_calls":[{"name":"done","arguments":{"summary":"Dockerfile reviewed and fixed."}}]',
      })),
    };

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Review dockerfile");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("Dockerfile reviewed and fixed.");
  });

  it("extracts summary from JSON embedded in surrounding text", async () => {
    const provider: LLMProvider = {
      name: "embedded-json-provider",
      generate: vi.fn(async () => ({
        content:
          'Here is the result:\n{"tool_calls":[{"name":"done","arguments":{"summary":"All done."}}]}',
      })),
    };

    const loop = new AgentLoop({
      provider,
      toolExecutor: mockToolExecutor(),
      tools,
      systemPrompt: "Test",
    });

    const result = await loop.run("Test prompt");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("All done.");
  });

  describe("escalating stall detection", () => {
    /** Build N identical tool call responses followed by a done response. */
    function repeatedCallResponses(count: number, name = "read_file", path = "same.ts") {
      const repeated: Array<{
        content: string;
        toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        stopReason: string;
      }> = [];
      for (let i = 0; i < count; i++) {
        repeated.push({
          content: "",
          toolCalls: [{ id: `c${i}`, name, arguments: { path } }],
          stopReason: "tool_use",
        });
      }
      // Terminal done response (may or may not be reached)
      repeated.push({
        content: "",
        toolCalls: [{ id: "done1", name: "done", arguments: { summary: "finished" } }],
        stopReason: "tool_use",
      });
      return repeated;
    }

    it("injects nudge message at 3 consecutive identical calls", async () => {
      // 3 identical + done = 4 responses
      const responses = repeatedCallResponses(3);
      const provider = mockProvider(responses);
      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "Test",
        maxIterations: 10,
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(true);
      // The provider should have been called 4 times (3 repeated + done after nudge)
      expect(provider.generateWithTools).toHaveBeenCalledTimes(4);

      // Verify the nudge was injected by checking the 4th call's messages
      const fourthCallArgs = (provider.generateWithTools as ReturnType<typeof vi.fn>).mock
        .calls[3][0];
      const userMessages = fourthCallArgs.messages.filter(
        (m: { role: string; content?: string }) =>
          m.role === "user" && m.content?.includes("repeating the same action"),
      );
      expect(userMessages.length).toBeGreaterThan(0);
    });

    it("injects restrict message at 5 consecutive identical calls", async () => {
      const responses = repeatedCallResponses(5);
      const provider = mockProvider(responses);
      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "Test",
        maxIterations: 10,
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(true);

      // Check that a "Do NOT call" restrict message was injected
      const allCalls = (provider.generateWithTools as ReturnType<typeof vi.fn>).mock.calls;
      const lastCallMessages = allCalls[allCalls.length - 1][0].messages;
      const restrictMessages = lastCallMessages.filter(
        (m: { role: string; content?: string }) =>
          m.role === "user" && m.content?.includes("Do NOT call"),
      );
      expect(restrictMessages.length).toBeGreaterThan(0);
    });

    it("terminates loop at 7 consecutive identical calls with success=false", async () => {
      const responses = repeatedCallResponses(7);
      const provider = mockProvider(responses);
      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "Test",
        maxIterations: 20,
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(false);
      expect(result.summary).toContain("Terminated");
      expect(result.summary).toContain("stuck in loop");
      expect(result.summary).toContain("read_file");
    });

    it("resets stale counter when different calls are interleaved", async () => {
      // 2 identical + 1 different + 2 identical + done = no escalation beyond nudge
      const provider = mockProvider([
        {
          content: "",
          toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }],
          stopReason: "tool_use",
        },
        {
          content: "",
          toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "a.ts" } }],
          stopReason: "tool_use",
        },
        // Different call breaks the streak
        {
          content: "",
          toolCalls: [{ id: "c3", name: "read_file", arguments: { path: "b.ts" } }],
          stopReason: "tool_use",
        },
        {
          content: "",
          toolCalls: [{ id: "c4", name: "read_file", arguments: { path: "a.ts" } }],
          stopReason: "tool_use",
        },
        {
          content: "",
          toolCalls: [{ id: "c5", name: "read_file", arguments: { path: "a.ts" } }],
          stopReason: "tool_use",
        },
        {
          content: "",
          toolCalls: [{ id: "done1", name: "done", arguments: { summary: "ok" } }],
          stopReason: "tool_use",
        },
      ]);

      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "Test",
        maxIterations: 20,
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(true);
      // Should NOT have been terminated — the interleaved different call reset the streak
      expect(result.summary).toBe("ok");
    });
  });

  describe("progressive summarization", () => {
    it("does not summarize without summarizationProvider", async () => {
      // Many iterations but no summarization provider — should just work normally
      const provider = mockProvider([
        {
          content: "",
          toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }],
          stopReason: "tool_use",
          usage: { promptTokens: 50000, completionTokens: 50000, totalTokens: 100000 },
        },
        {
          content: "",
          toolCalls: [{ id: "c2", name: "done", arguments: { summary: "done" } }],
          stopReason: "tool_use",
        },
      ]);

      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(),
        tools,
        systemPrompt: "Test",
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(true);
    });

    it("triggers summarization when token estimate exceeds 60% of budget", async () => {
      const summarizationProvider: LLMProvider = {
        name: "summarizer",
        generate: vi.fn(async () => ({
          content: "Summary: read file a.ts, executed command, succeeded.",
        })),
      };

      // Build enough messages to exceed 60% of a small budget.
      // With maxTotalTokens=1000, threshold=600 tokens. Each tool result adds chars.
      // We need the provider to report enough usage to trigger the check.
      const responses = [];
      for (let i = 0; i < 8; i++) {
        responses.push({
          content: "x".repeat(400), // ~100 tokens worth of content per message
          toolCalls: [{ id: `c${i}`, name: "read_file", arguments: { path: `file${i}.ts` } }],
          stopReason: "tool_use" as const,
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        });
      }
      responses.push({
        content: "",
        toolCalls: [{ id: "done1", name: "done", arguments: { summary: "complete" } }],
        stopReason: "tool_use" as const,
      });

      const provider = mockProvider(responses);
      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(
          new Map([["read_file", "x".repeat(500)]]), // large tool results to inflate context
        ),
        tools,
        systemPrompt: "Test",
        maxTotalTokens: 1000, // small budget so 60% threshold is easily exceeded
        summarizationProvider,
      });

      const result = await loop.run("Task");
      expect(result.success).toBe(true);
      expect(summarizationProvider.generate).toHaveBeenCalled();
    });

    it("preserves initial user message after summarization", async () => {
      const summarizationProvider: LLMProvider = {
        name: "summarizer",
        generate: vi.fn(async () => ({
          content: "Summary of prior work.",
        })),
      };

      const responses = [];
      for (let i = 0; i < 8; i++) {
        responses.push({
          content: "x".repeat(400),
          toolCalls: [{ id: `c${i}`, name: "read_file", arguments: { path: `f${i}.ts` } }],
          stopReason: "tool_use" as const,
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        });
      }
      responses.push({
        content: "",
        toolCalls: [{ id: "done1", name: "done", arguments: { summary: "all done" } }],
        stopReason: "tool_use" as const,
      });

      const provider = mockProvider(responses);
      const loop = new AgentLoop({
        provider,
        toolExecutor: mockToolExecutor(new Map([["read_file", "x".repeat(500)]])),
        tools,
        systemPrompt: "Test",
        maxTotalTokens: 1000,
        summarizationProvider,
      });

      await loop.run("My original task prompt");

      // Verify the provider always sees the original user message first.
      // Check the last call to generateWithTools — messages[0] should be the original prompt.
      const allCalls = (provider.generateWithTools as ReturnType<typeof vi.fn>).mock.calls;
      const lastCallMessages = allCalls[allCalls.length - 1][0].messages;
      expect(lastCallMessages[0].role).toBe("user");
      expect(lastCallMessages[0].content).toBe("My original task prompt");
    });
  });
});
