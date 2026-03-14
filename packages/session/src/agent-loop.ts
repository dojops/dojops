import type {
  LLMProvider,
  LLMToolResponse,
  AgentMessage,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from "@dojops/core";
import { buildToolCallingSystemPrompt, parseToolCallsFromContent } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";

export interface AgentLoopOptions {
  provider: LLMProvider;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  systemPrompt: string;
  /** Maximum number of LLM iterations (default: 20). */
  maxIterations?: number;
  /** Maximum total tokens before stopping (default: 200_000). */
  maxTotalTokens?: number;
  onIteration?: (iteration: number, message: AgentMessage) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onThinking?: (text: string) => void;
}

export interface AgentLoopResult {
  success: boolean;
  summary: string;
  iterations: number;
  totalTokens: number;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  filesWritten: string[];
  filesModified: string[];
}

/**
 * ReAct agent loop controller.
 * Iteratively: calls LLM with tools → executes tool calls → appends results → repeats.
 * Terminates on: "done" tool, end_turn with no tool calls, max iterations, or token budget.
 */
export class AgentLoop {
  private readonly maxIterations: number;
  private readonly maxTotalTokens: number;
  private totalTokens = 0;

  constructor(private readonly opts: AgentLoopOptions) {
    this.maxIterations = opts.maxIterations ?? 20;
    this.maxTotalTokens = opts.maxTotalTokens ?? 200_000;
  }

  async run(userPrompt: string): Promise<AgentLoopResult> {
    const messages: AgentMessage[] = [{ role: "user", content: userPrompt }];
    const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    let summary = "";
    let success = false;
    let iterationCount = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      iterationCount++;
      // 1. Call LLM with tools
      const response = await this.generateWithTools(messages);

      // 2. Track token usage
      if (response.usage) {
        this.totalTokens += response.usage.totalTokens;
      }

      // 3. Append assistant message
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      };
      messages.push(assistantMsg);
      this.opts.onIteration?.(iteration, assistantMsg);

      // 4. If LLM produced text with no tool calls, report thinking and check for end
      if (response.content && this.opts.onThinking) {
        this.opts.onThinking(response.content);
      }

      // 5. Check stop conditions
      if (response.stopReason === "end_turn" && response.toolCalls.length === 0) {
        summary = response.content || "Task completed (no summary provided).";
        success = true;
        break;
      }

      if (response.stopReason === "max_tokens") {
        summary = "Stopped: LLM response hit max tokens limit.";
        break;
      }

      // 6. Check for "done" tool
      const doneCall = response.toolCalls.find((tc) => tc.name === "done");
      if (doneCall) {
        summary = (doneCall.arguments.summary as string) || "Task completed.";
        success = true;
        allToolCalls.push({ name: doneCall.name, arguments: doneCall.arguments });
        break;
      }

      // 7. Execute tool calls
      for (const call of response.toolCalls) {
        this.opts.onToolCall?.(call);
        allToolCalls.push({ name: call.name, arguments: call.arguments });

        const result = await this.opts.toolExecutor.execute(call);
        this.opts.onToolResult?.(result);

        messages.push({
          role: "tool",
          callId: call.id,
          content: result.output,
          isError: result.isError,
        });
      }

      // 8. Check token budget
      if (this.totalTokens >= this.maxTotalTokens) {
        summary = `Stopped: token budget exhausted (${this.totalTokens}/${this.maxTotalTokens}).`;
        break;
      }

      // 9. Context management: summarize old tool results to prevent context overflow
      this.compactMessages(messages);
    }

    if (iterationCount >= this.maxIterations && !success) {
      summary = `Stopped: reached maximum iterations (${this.maxIterations}).`;
    }

    return {
      success,
      summary,
      iterations: iterationCount,
      totalTokens: this.totalTokens,
      toolCalls: allToolCalls,
      filesWritten: this.opts.toolExecutor.getFilesWritten(),
      filesModified: this.opts.toolExecutor.getFilesModified(),
    };
  }

  /**
   * Call LLM with tools — uses native generateWithTools if available,
   * falls back to prompt-based tool calling otherwise.
   */
  private async generateWithTools(messages: AgentMessage[]): Promise<LLMToolResponse> {
    if (this.opts.provider.generateWithTools) {
      return this.opts.provider.generateWithTools({
        system: this.opts.systemPrompt,
        messages,
        tools: this.opts.tools,
      });
    }

    return this.fallbackGenerateWithTools(messages);
  }

  /** Prompt-based fallback for providers without native tool-calling. */
  private async fallbackGenerateWithTools(messages: AgentMessage[]): Promise<LLMToolResponse> {
    const augmentedSystem = buildToolCallingSystemPrompt(this.opts.systemPrompt, this.opts.tools);

    // Convert AgentMessages to ChatMessages for the standard generate() call
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return { role: "user" as const, content: `Tool result (${m.callId}): ${m.content}` };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          const callsJson = JSON.stringify({
            tool_calls: m.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
          });
          return { role: "assistant" as const, content: callsJson };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      });

    const response = await this.opts.provider.generate({
      system: augmentedSystem,
      prompt: "", // Not used when messages is provided
      messages: chatMessages,
    });

    const result = parseToolCallsFromContent(response.content);
    result.usage = response.usage;
    return result;
  }

  /**
   * Compact old messages to prevent context overflow.
   * After 15 tool result messages, summarize older ones.
   */
  private compactMessages(messages: AgentMessage[]): void {
    const toolMessages = messages.filter((m) => m.role === "tool");
    if (toolMessages.length <= 15) return;

    // Find the oldest tool results beyond the last 10
    const keepCount = 10;
    let toolsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tool") {
        toolsSeen++;
        if (toolsSeen > keepCount) {
          // Truncate old tool results to a single line
          const msg = messages[i] as {
            role: "tool";
            callId: string;
            content: string;
            isError?: boolean;
          };
          if (msg.content.length > 200) {
            msg.content = msg.content.slice(0, 200) + "\n[truncated — old tool result]";
          }
        }
      }
    }
  }
}
