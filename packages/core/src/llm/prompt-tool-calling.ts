import type { ToolDefinition, ToolCall, LLMToolResponse } from "./tool-types";

/**
 * Build a system prompt that instructs the LLM to produce tool calls as JSON.
 * Used as a fallback for providers without native tool-calling support (e.g. Ollama).
 */
export function buildToolCallingSystemPrompt(baseSystem: string, tools: ToolDefinition[]): string {
  const toolDescriptions = tools
    .map((t) => {
      const params = JSON.stringify(t.parameters, null, 2);
      return `### ${t.name}\n${t.description}\nParameters (JSON Schema):\n${params}`;
    })
    .join("\n\n");

  return `${baseSystem}

## Available Tools

You have access to the following tools. To use a tool, respond with ONLY a JSON object in the exact format shown below. Do not include any other text before or after the JSON.

${toolDescriptions}

## Response Format

When you want to call tools, respond with ONLY this JSON (no markdown fences, no extra text):
{"tool_calls": [{"name": "tool_name", "arguments": {...}}]}

When you want to respond with text only (no tool calls), respond with:
{"text": "your response here"}

When the task is complete, call the "done" tool:
{"tool_calls": [{"name": "done", "arguments": {"summary": "what was accomplished"}}]}

IMPORTANT: Always respond with valid JSON in one of the two formats above. Never mix text and tool calls.`;
}

/**
 * Parse tool calls from LLM text output (for prompt-based fallback).
 * Expects JSON in the format: {"tool_calls": [{"name": "...", "arguments": {...}}]}
 */
export function parseToolCallsFromContent(content: string): LLMToolResponse {
  const trimmed = content.trim();

  // Try to extract JSON from the content (may be wrapped in markdown fences)
  let jsonStr = trimmed;
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(trimmed);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
      const toolCalls: ToolCall[] = parsed.tool_calls.map(
        (tc: { name: string; arguments?: Record<string, unknown> }, i: number) => ({
          id: `fallback-call-${i}`,
          name: tc.name,
          arguments: tc.arguments ?? {},
        }),
      );

      const hasDone = toolCalls.some((tc) => tc.name === "done");
      return {
        content: "",
        toolCalls,
        stopReason: hasDone ? "end_turn" : "tool_use",
      };
    }

    if (parsed.text && typeof parsed.text === "string") {
      return {
        content: parsed.text,
        toolCalls: [],
        stopReason: "end_turn",
      };
    }
  } catch {
    // Not valid JSON — treat as plain text response
  }

  // Fallback: treat entire content as text
  return {
    content: trimmed,
    toolCalls: [],
    stopReason: "end_turn",
  };
}
