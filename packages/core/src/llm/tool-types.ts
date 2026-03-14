/** A tool the LLM can call. JSON Schema describes the parameters. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/** A tool invocation from the LLM. */
export interface ToolCall {
  id: string; // Provider-assigned call ID
  name: string; // Tool name
  arguments: Record<string, unknown>;
}

/** Result of executing a tool call. */
export interface ToolResult {
  callId: string; // Matches ToolCall.id
  output: string; // Text result shown to LLM
  isError?: boolean; // Whether the tool execution failed
}

/** Extended message type supporting tool interactions. */
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; content: string; isError?: boolean };

/** Request for tool-calling generation. */
export interface LLMToolRequest {
  system?: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/** Response from tool-calling generation. */
export interface LLMToolResponse {
  content: string; // Text response (may be empty if only tool calls)
  toolCalls: ToolCall[]; // Tool calls to execute (empty = done)
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
