/**
 * Stream-JSON output format: emits typed JSONL events (one per line) for
 * CI/CD integration and tool chaining.
 */

export type StreamEvent =
  | { type: "init"; provider: string; model: string; timestamp: string }
  | { type: "chunk"; content: string }
  | { type: "tool_use"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; isError?: boolean }
  | { type: "result"; content: string; stats?: Record<string, unknown> }
  | { type: "error"; message: string };

export function emitStreamEvent(event: StreamEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}
