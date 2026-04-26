import type { LLMProvider, AgentMessage, ToolDefinition, ToolCall, ToolResult } from "@dojops/core";
import { AgentContext } from "./agent-context";
import type { ContextBudgetTracker } from "./context-budget";
import type { ToolExecutor } from "@dojops/executor";

// ── Types ────────────────────────────────────────────────────────────

export type WorkerStatus = "pending" | "running" | "completed" | "failed";

export interface WorkerTask {
  id: string;
  description: string;
  agent?: string;
  dependsOn: string[];
  status: WorkerStatus;
  result?: string;
  error?: string;
  tokensUsed: number;
}

export interface CoordinatorResult {
  success: boolean;
  summary: string;
  workers: WorkerTask[];
  totalTokens: number;
  iterations: number;
}

export interface CoordinatorOptions {
  provider: LLMProvider;
  providerName?: string;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  /** Budget tracker from parent context (for sub-agent budget allocation). */
  parentTracker?: ContextBudgetTracker;
  /** Max coordinator iterations (default: 20). */
  maxIterations?: number;
  /** Budget fraction per worker (default: 0.15). */
  workerBudgetFraction?: number;
  /** Max concurrent workers (default: 3). */
  maxConcurrentWorkers?: number;
}

// ── Coordinator tool definitions ─────────────────────────────────────

const COORDINATOR_TOOLS: ToolDefinition[] = [
  {
    name: "spawn_worker",
    description:
      "Spawn a worker agent to handle a specific subtask. " +
      "The worker gets its own token budget and tool set. " +
      "Returns a worker ID for tracking.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Unique ID for this worker task" },
        description: {
          type: "string",
          description: "What the worker should accomplish",
        },
        agent: {
          type: "string",
          description: "Optional specialist agent to use (e.g., 'terraform', 'kubernetes')",
        },
        depends_on: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that must complete before this worker starts",
        },
      },
      required: ["task_id", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "check_workers",
    description:
      "Check the status of all spawned workers. Returns each worker's " +
      "status (pending/running/completed/failed), result summary, and token usage.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description:
      "Send a message or context to a running or pending worker. " +
      "Use this to share information discovered by other workers.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Worker task ID or '*' for broadcast" },
        message: { type: "string", description: "Message content to send" },
      },
      required: ["to", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "synthesize",
    description:
      "Synthesize the results from all completed workers into a final output. " +
      "Call this when all workers are done or when you have enough information.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Final synthesis of all worker results" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

// ── CoordinatorAgent ─────────────────────────────────────────────────

/**
 * Coordinator agent for complex, multi-domain tasks.
 *
 * The coordinator is an LLM-in-the-loop that:
 * 1. Analyzes the task and decomposes it into subtasks
 * 2. Spawns worker sub-agents for each subtask
 * 3. Monitors worker progress and shares context between them
 * 4. Synthesizes results into a final output
 *
 * Unlike the fixed TaskGraph planner, the coordinator can adapt its
 * plan based on worker results (adaptive planning).
 */
export class CoordinatorAgent {
  private readonly provider: LLMProvider;
  private readonly providerName: string;
  private readonly toolExecutor: ToolExecutor;
  private readonly baseTools: ToolDefinition[];
  private readonly parentTracker?: ContextBudgetTracker;
  private readonly maxIterations: number;
  private readonly workerBudgetFraction: number;
  private readonly maxConcurrentWorkers: number;
  private readonly workers = new Map<string, WorkerTask>();
  private readonly workerMessages = new Map<string, string[]>();

  constructor(opts: CoordinatorOptions) {
    this.provider = opts.provider;
    this.providerName = opts.providerName ?? opts.provider.name;
    this.toolExecutor = opts.toolExecutor;
    this.baseTools = opts.tools;
    this.parentTracker = opts.parentTracker;
    this.maxIterations = opts.maxIterations ?? 20;
    this.workerBudgetFraction = opts.workerBudgetFraction ?? 0.15;
    this.maxConcurrentWorkers = opts.maxConcurrentWorkers ?? 3;
  }

  /**
   * Run the coordinator on a task. The coordinator LLM decomposes the task,
   * spawns workers, and synthesizes results.
   */
  async run(task: string, systemContext?: string): Promise<CoordinatorResult> {
    if (!this.provider.generateWithTools) {
      throw new Error(`Provider "${this.providerName}" does not support tool calling`);
    }

    const systemPrompt = this.buildSystemPrompt(systemContext);
    const messages: AgentMessage[] = [{ role: "user", content: task }];

    let iterations = 0;
    let synthesisResult: string | null = null;

    while (iterations < this.maxIterations && !synthesisResult) {
      iterations++;

      const response = await this.provider.generateWithTools({
        system: systemPrompt,
        messages,
        tools: COORDINATOR_TOOLS,
      });

      if (response.toolCalls.length === 0) {
        if (response.content) {
          messages.push({ role: "assistant", content: response.content });
        }
        break;
      }

      // Push the assistant message with tool calls for context
      messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        const output = await this.handleToolCall(call);
        messages.push({
          role: "tool",
          callId: call.id,
          content: output,
        });

        if (call.name === "synthesize") {
          synthesisResult = output;
        }
      }

      // Run ready workers between iterations
      await this.runReadyWorkers();
    }

    const totalTokens = Array.from(this.workers.values()).reduce((sum, w) => sum + w.tokensUsed, 0);

    return {
      success: synthesisResult !== null,
      summary: synthesisResult ?? this.buildFallbackSummary(),
      workers: Array.from(this.workers.values()),
      totalTokens,
      iterations,
    };
  }

  /**
   * Handle a coordinator tool call.
   */
  private async handleToolCall(call: ToolCall): Promise<string> {
    const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;

    switch (call.name) {
      case "spawn_worker":
        return this.spawnWorker(args);
      case "check_workers":
        return this.checkWorkers();
      case "send_message":
        return this.sendMessage(args);
      case "synthesize":
        return args.summary ?? "(no summary provided)";
      default:
        return `Unknown tool: ${call.name}`;
    }
  }

  /**
   * Register a new worker task.
   */
  private spawnWorker(args: {
    task_id: string;
    description: string;
    agent?: string;
    depends_on?: string[];
  }): string {
    if (this.workers.has(args.task_id)) {
      return `Worker ${args.task_id} already exists`;
    }

    const worker: WorkerTask = {
      id: args.task_id,
      description: args.description,
      agent: args.agent,
      dependsOn: args.depends_on ?? [],
      status: "pending",
      tokensUsed: 0,
    };

    this.workers.set(args.task_id, worker);
    this.workerMessages.set(args.task_id, []);

    return `Worker ${args.task_id} spawned (pending). Will execute when dependencies are met.`;
  }

  /**
   * Check status of all workers.
   */
  private checkWorkers(): string {
    if (this.workers.size === 0) {
      return "No workers spawned yet.";
    }

    const lines: string[] = [];
    for (const worker of this.workers.values()) {
      const deps =
        worker.dependsOn.length > 0 ? ` (depends on: ${worker.dependsOn.join(", ")})` : "";
      const result = worker.result ? ` — ${worker.result.slice(0, 200)}` : "";
      const error = worker.error ? ` — ERROR: ${worker.error.slice(0, 200)}` : "";
      lines.push(`[${worker.status}] ${worker.id}: ${worker.description}${deps}${result}${error}`);
    }

    return lines.join("\n");
  }

  /**
   * Send a message to a worker.
   */
  private sendMessage(args: { to: string; message: string }): string {
    if (args.to === "*") {
      for (const [, msgs] of this.workerMessages) {
        msgs.push(args.message);
      }
      return `Broadcast sent to ${this.workerMessages.size} workers.`;
    }

    const msgs = this.workerMessages.get(args.to);
    if (!msgs) {
      return `Worker ${args.to} not found.`;
    }
    msgs.push(args.message);
    return `Message sent to worker ${args.to}.`;
  }

  /**
   * Run workers whose dependencies are satisfied.
   */
  private async runReadyWorkers(): Promise<void> {
    const ready = this.getReadyWorkers();
    const running = Array.from(this.workers.values()).filter((w) => w.status === "running").length;
    const slots = this.maxConcurrentWorkers - running;

    for (const worker of ready.slice(0, slots)) {
      worker.status = "running";
      try {
        const result = await this.executeWorker(worker);
        worker.status = "completed";
        worker.result = result;
      } catch (err) {
        worker.status = "failed";
        worker.error = String(err).slice(0, 500);
      }
    }
  }

  /**
   * Get workers that are pending and have all dependencies satisfied.
   */
  private getReadyWorkers(): WorkerTask[] {
    return Array.from(this.workers.values()).filter((w) => {
      if (w.status !== "pending") return false;
      return w.dependsOn.every((dep) => {
        const depWorker = this.workers.get(dep);
        return depWorker && depWorker.status === "completed";
      });
    });
  }

  /**
   * Execute a worker by creating a child AgentContext and running it.
   */
  private async executeWorker(worker: WorkerTask): Promise<string> {
    const messages = this.workerMessages.get(worker.id) ?? [];
    const contextMessages =
      messages.length > 0 ? `\n\nAdditional context from coordinator:\n${messages.join("\n")}` : "";

    const workerBudget = this.parentTracker
      ? Math.max(
          5_000,
          Math.floor(this.parentTracker.budgetRemaining() * this.workerBudgetFraction),
        )
      : 25_000;

    const ctx = new AgentContext({
      provider: this.provider,
      providerName: this.providerName,
      toolExecutor: this.toolExecutor,
      tools: this.baseTools,
      systemPrompt: `You are a worker agent assigned a specific subtask.
Complete the task below. Be focused and efficient.

Task: ${worker.description}${contextMessages}`,
      maxTotalTokens: workerBudget,
    });

    if (!ctx.provider.generateWithTools) {
      throw new Error(`Provider "${ctx.providerName}" does not support tool calling`);
    }

    // Simple ReAct loop for the worker
    ctx.messages.push({ role: "user", content: worker.description });

    let iterations = 0;
    const maxWorkerIterations = 5;

    while (iterations < maxWorkerIterations) {
      iterations++;

      const response = await ctx.provider.generateWithTools({
        system: ctx.systemPrompt,
        messages: ctx.messages,
        tools: ctx.tools,
      });

      if (response.usage) {
        ctx.tracker.recordUsage(response.usage);
        worker.tokensUsed += response.usage.totalTokens;
      }

      if (response.toolCalls.length === 0) {
        if (response.content) {
          ctx.messages.push({ role: "assistant", content: response.content });
        }
        break;
      }

      // Push assistant message with tool calls
      ctx.messages.push({
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      });

      // Execute tool calls
      for (const call of response.toolCalls) {
        const result: ToolResult = await ctx.toolExecutor.execute(call);
        ctx.messages.push({
          role: "tool",
          callId: call.id,
          content: result.output,
        });
      }
    }

    return ctx.summarizeResults();
  }

  /**
   * Build the coordinator system prompt.
   */
  private buildSystemPrompt(context?: string): string {
    const contextBlock = context ? `\n\nProject context:\n${context}` : "";

    return `You are a coordinator agent. Your job is to decompose complex tasks into smaller subtasks, spawn worker agents for each, and synthesize their results.

Available tools:
- spawn_worker: Create a worker for a subtask (specify task_id, description, optional agent, optional depends_on)
- check_workers: Check the status of all workers
- send_message: Share information with workers (to a specific worker or broadcast to all)
- synthesize: Produce the final result from all worker outputs

Strategy:
1. Analyze the task and identify independent subtasks
2. Spawn workers for subtasks that can run in parallel
3. Use depends_on for subtasks that need prior results
4. Check worker status periodically
5. Send relevant context to workers that need it
6. Call synthesize when all critical workers are done

Rules:
- Keep subtasks focused (one domain per worker)
- Set dependencies to prevent wasted work
- If a worker fails, you can spawn a replacement with adjusted instructions
- Call synthesize even if some non-critical workers failed${contextBlock}`;
  }

  /**
   * Build a fallback summary if the coordinator didn't call synthesize.
   */
  private buildFallbackSummary(): string {
    const completed = Array.from(this.workers.values()).filter((w) => w.status === "completed");
    const failed = Array.from(this.workers.values()).filter((w) => w.status === "failed");

    if (completed.length === 0) {
      return "No workers completed successfully.";
    }

    const lines = ["Results from completed workers:", ""];
    for (const w of completed) {
      lines.push(`## ${w.id}: ${w.description}`, w.result ?? "(no output)", "");
    }

    if (failed.length > 0) {
      lines.push(`${failed.length} worker(s) failed:`);
      for (const w of failed) {
        lines.push(`- ${w.id}: ${w.error}`);
      }
    }

    return lines.join("\n");
  }
}
