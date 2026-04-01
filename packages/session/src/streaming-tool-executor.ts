import type { ToolCall, ToolResult } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";

// ── Types ────────────────────────────────────────────────────────────

export interface StreamingToolExecutorOptions {
  toolExecutor: ToolExecutor;
  /** Max concurrent read-only tool executions (default: 5). */
  maxConcurrency?: number;
  /** Tools known to be safe for concurrent execution. */
  concurrencySafeTools?: Set<string>;
  /** Called when a tool starts execution. */
  onToolStart?: (call: ToolCall) => void;
  /** Called when a tool completes execution. */
  onToolComplete?: (call: ToolCall, result: ToolResult) => void;
}

/** Result of executing a batch of tool calls. Preserves original order. */
export interface BatchExecutionResult {
  results: ToolResult[];
  /** Total wall-clock time for the batch (ms). */
  durationMs: number;
  /** How many tools ran concurrently (1 = fully serial). */
  maxParallelism: number;
}

// ── Default concurrency-safe tools ───────────────────────────────────

/** Tools that only read state and can safely run in parallel. */
const DEFAULT_SAFE_TOOLS = new Set(["read_file", "search_files", "list_files", "search_skills"]);

/** Tools that modify state and must run serially. */
const WRITE_TOOLS = new Set(["write_file", "edit_file", "run_command", "run_skill", "done"]);

// ── StreamingToolExecutor ────────────────────────────────────────────

/**
 * Executes tool calls with concurrency optimization.
 *
 * When the LLM returns multiple tool calls in one response, this executor
 * partitions them into concurrent-safe (read-only) and serial (write) batches,
 * then executes read-only batches in parallel up to a concurrency limit.
 *
 * Execution order:
 * 1. Leading read-only tools → run concurrently
 * 2. First write tool → run serially
 * 3. Remaining tools → run serially (write order matters)
 *
 * Results are always returned in the original tool call order regardless
 * of execution order, so the conversation history stays consistent.
 */
export class StreamingToolExecutor {
  private readonly executor: ToolExecutor;
  private readonly maxConcurrency: number;
  private readonly safeTools: Set<string>;
  private readonly onToolStart?: (call: ToolCall) => void;
  private readonly onToolComplete?: (call: ToolCall, result: ToolResult) => void;

  constructor(opts: StreamingToolExecutorOptions) {
    this.executor = opts.toolExecutor;
    this.maxConcurrency = opts.maxConcurrency ?? 5;
    this.safeTools = opts.concurrencySafeTools ?? DEFAULT_SAFE_TOOLS;
    this.onToolStart = opts.onToolStart;
    this.onToolComplete = opts.onToolComplete;
  }

  /**
   * Execute a batch of tool calls with automatic concurrency optimization.
   * Read-only tools at the start of the batch run in parallel.
   * Write tools and everything after run serially.
   */
  async executeBatch(calls: ToolCall[]): Promise<BatchExecutionResult> {
    if (calls.length === 0) {
      return { results: [], durationMs: 0, maxParallelism: 0 };
    }

    const start = Date.now();
    const { concurrent, serial } = this.partition(calls);

    // Phase 1: Execute concurrent-safe calls in parallel
    const concurrentResults = await this.executeConcurrent(concurrent);

    // Phase 2: Execute remaining calls serially
    const serialResults = await this.executeSerial(serial);

    // Merge results back in original order
    const resultMap = new Map<string, ToolResult>();
    for (const r of [...concurrentResults, ...serialResults]) {
      resultMap.set(r.callId, r);
    }

    const orderedResults = calls.map((call) => resultMap.get(call.id)!);

    return {
      results: orderedResults,
      durationMs: Date.now() - start,
      maxParallelism: Math.min(concurrent.length, this.maxConcurrency),
    };
  }

  /**
   * Execute a single tool call. Useful for streaming mode where
   * tools are processed one at a time as they arrive.
   */
  async executeOne(call: ToolCall): Promise<ToolResult> {
    this.onToolStart?.(call);
    const result = await this.executor.execute(call);
    this.onToolComplete?.(call, result);
    return result;
  }

  /**
   * Check if a tool is safe for concurrent execution.
   */
  isConcurrencySafe(toolName: string): boolean {
    return this.safeTools.has(toolName) && !WRITE_TOOLS.has(toolName);
  }

  // ── Private ────────────────────────────────────────────────────────

  /**
   * Partition tool calls into concurrent-safe prefix and serial remainder.
   * Takes the longest prefix of read-only tools for concurrent execution.
   */
  private partition(calls: ToolCall[]): { concurrent: ToolCall[]; serial: ToolCall[] } {
    let splitIdx = 0;
    for (let i = 0; i < calls.length; i++) {
      if (this.isConcurrencySafe(calls[i].name)) {
        splitIdx = i + 1;
      } else {
        break;
      }
    }

    return {
      concurrent: calls.slice(0, splitIdx),
      serial: calls.slice(splitIdx),
    };
  }

  /** Execute tools concurrently with a concurrency limit. */
  private async executeConcurrent(calls: ToolCall[]): Promise<ToolResult[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) return [await this.executeOne(calls[0])];

    // Semaphore-based concurrency limiting
    const results: ToolResult[] = [];
    const executing = new Set<Promise<void>>();

    for (const call of calls) {
      const p = (async () => {
        const result = await this.executeOne(call);
        results.push(result);
      })();

      executing.add(p);
      p.finally(() => executing.delete(p));

      if (executing.size >= this.maxConcurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /** Execute tools one at a time, in order. */
  private async executeSerial(calls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.executeOne(call));
    }
    return results;
  }
}

/**
 * Partition tool calls by concurrency safety.
 * Standalone utility for use outside StreamingToolExecutor.
 */
export function partitionToolCalls(
  calls: ToolCall[],
  safeTools: Set<string> = DEFAULT_SAFE_TOOLS,
): { readOnly: ToolCall[]; write: ToolCall[] } {
  const readOnly: ToolCall[] = [];
  const write: ToolCall[] = [];

  for (const call of calls) {
    if (safeTools.has(call.name) && !WRITE_TOOLS.has(call.name)) {
      readOnly.push(call);
    } else {
      write.push(call);
    }
  }

  return { readOnly, write };
}
