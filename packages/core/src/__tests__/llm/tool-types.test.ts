import { describe, it, expect } from "vitest";
import type { ToolDefinition, ToolCall, ToolResult, AgentMessage } from "../../llm/tool-types";
import { AGENT_TOOLS, READ_FILE_TOOL, DONE_TOOL } from "../../llm/tool-defs";
import {
  buildToolCallingSystemPrompt,
  parseToolCallsFromContent,
} from "../../llm/prompt-tool-calling";

describe("ToolDefinition", () => {
  it("has all required fields", () => {
    const tool: ToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
    };
    expect(tool.name).toBe("test_tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.parameters).toBeDefined();
  });
});

describe("ToolCall", () => {
  it("stores call ID, name, and arguments", () => {
    const call: ToolCall = { id: "call-1", name: "read_file", arguments: { path: "foo.ts" } };
    expect(call.id).toBe("call-1");
    expect(call.name).toBe("read_file");
    expect(call.arguments.path).toBe("foo.ts");
  });
});

describe("ToolResult", () => {
  it("stores callId, output, and optional isError", () => {
    const success: ToolResult = { callId: "call-1", output: "file contents" };
    expect(success.isError).toBeUndefined();

    const failure: ToolResult = { callId: "call-2", output: "not found", isError: true };
    expect(failure.isError).toBe(true);
  });
});

describe("AgentMessage", () => {
  it("supports all four role variants", () => {
    const msgs: AgentMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Hi",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "x" } }],
      },
      { role: "tool", callId: "c1", content: "file data" },
    ];
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("assistant");
    expect(msgs[3].role).toBe("tool");
  });
});

describe("AGENT_TOOLS", () => {
  it("defines exactly 7 tools", () => {
    expect(AGENT_TOOLS).toHaveLength(7);
  });

  it("contains all expected tool names", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "read_file",
      "write_file",
      "edit_file",
      "run_command",
      "run_skill",
      "search_files",
      "done",
    ]);
  });

  it("each tool has valid JSON Schema parameters", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.parameters).toBeDefined();
      expect((tool.parameters as Record<string, unknown>).type).toBe("object");
      expect((tool.parameters as Record<string, unknown>).properties).toBeDefined();
    }
  });

  it("read_file requires path", () => {
    expect((READ_FILE_TOOL.parameters as Record<string, unknown>).required).toContain("path");
  });

  it("done requires summary", () => {
    expect((DONE_TOOL.parameters as Record<string, unknown>).required).toContain("summary");
  });
});

describe("buildToolCallingSystemPrompt", () => {
  it("includes base system prompt and tool descriptions", () => {
    const result = buildToolCallingSystemPrompt("Base prompt.", [READ_FILE_TOOL]);
    expect(result).toContain("Base prompt.");
    expect(result).toContain("read_file");
    expect(result).toContain("Read a file");
    expect(result).toContain("tool_calls");
  });
});

describe("parseToolCallsFromContent", () => {
  it("parses valid tool_calls JSON", () => {
    const content = '{"tool_calls": [{"name": "read_file", "arguments": {"path": "foo.ts"}}]}';
    const result = parseToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
    expect(result.toolCalls[0].arguments.path).toBe("foo.ts");
    expect(result.stopReason).toBe("tool_use");
  });

  it("parses done tool call as end_turn", () => {
    const content = '{"tool_calls": [{"name": "done", "arguments": {"summary": "All done"}}]}';
    const result = parseToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.stopReason).toBe("end_turn");
  });

  it("parses text response", () => {
    const content = '{"text": "Hello there"}';
    const result = parseToolCallsFromContent(content);
    expect(result.content).toBe("Hello there");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
  });

  it("handles markdown-fenced JSON", () => {
    const content =
      '```json\n{"tool_calls": [{"name": "done", "arguments": {"summary": "ok"}}]}\n```';
    const result = parseToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("done");
  });

  it("falls back to plain text for invalid JSON", () => {
    const content = "Just some plain text response.";
    const result = parseToolCallsFromContent(content);
    expect(result.content).toBe("Just some plain text response.");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
  });

  it("assigns synthetic IDs to fallback tool calls", () => {
    const content =
      '{"tool_calls": [{"name": "read_file", "arguments": {"path": "a"}}, {"name": "read_file", "arguments": {"path": "b"}}]}';
    const result = parseToolCallsFromContent(content);
    expect(result.toolCalls[0].id).toBe("fallback-call-0");
    expect(result.toolCalls[1].id).toBe("fallback-call-1");
  });
});
