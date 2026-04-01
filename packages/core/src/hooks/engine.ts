import { execFile } from "node:child_process";
import type { HookDefinition, HookEvent, HookEventData, HookResult, HookConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * HookEngine manages lifecycle hooks for the dojops engine.
 *
 * Hooks are registered at startup (from config or programmatically) and
 * executed when lifecycle events fire. Each hook runs asynchronously and
 * is non-blocking by default (errors are captured, not thrown).
 *
 * Two execution types:
 * - "command": runs a shell command with event data piped to stdin as JSON
 * - "http": POSTs event data as JSON to a configured URL
 */
export class HookEngine {
  private readonly hooks: Map<string, HookDefinition> = new Map();
  private readonly eventIndex: Map<HookEvent, string[]> = new Map();

  /** Optional logger — set to enable debug output. */
  onLog?: (level: "debug" | "warn" | "error", message: string) => void;

  constructor(config?: HookConfig) {
    if (config) {
      for (const hook of config.hooks) {
        this.register(hook);
      }
    }
  }

  /** Register a hook. Replaces any existing hook with the same ID. */
  register(hook: HookDefinition): void {
    // Validate
    if (!hook.id) throw new Error("Hook must have an id");
    if (!hook.events || hook.events.length === 0) {
      throw new Error(`Hook '${hook.id}' must subscribe to at least one event`);
    }
    if (hook.type === "command" && !hook.command) {
      throw new Error(`Hook '${hook.id}' is type 'command' but has no command`);
    }
    if (hook.type === "http" && !hook.url) {
      throw new Error(`Hook '${hook.id}' is type 'http' but has no url`);
    }

    // Remove from old event index if replacing
    if (this.hooks.has(hook.id)) {
      this.unregister(hook.id);
    }

    this.hooks.set(hook.id, hook);

    // Index by event for fast lookup
    for (const event of hook.events) {
      const list = this.eventIndex.get(event) ?? [];
      list.push(hook.id);
      this.eventIndex.set(event, list);
    }
  }

  /** Unregister a hook by ID. */
  unregister(hookId: string): boolean {
    const hook = this.hooks.get(hookId);
    if (!hook) return false;

    // Remove from event index
    for (const event of hook.events) {
      const list = this.eventIndex.get(event);
      if (list) {
        const filtered = list.filter((id) => id !== hookId);
        if (filtered.length > 0) {
          this.eventIndex.set(event, filtered);
        } else {
          this.eventIndex.delete(event);
        }
      }
    }

    this.hooks.delete(hookId);
    return true;
  }

  /** Get all registered hooks. */
  getHooks(): HookDefinition[] {
    return [...this.hooks.values()];
  }

  /** Get hooks subscribed to a specific event. */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    const ids = this.eventIndex.get(event) ?? [];
    return ids
      .map((id) => this.hooks.get(id))
      .filter((h): h is HookDefinition => h !== undefined && !h.disabled);
  }

  /**
   * Emit a lifecycle event. Executes all subscribed hooks concurrently.
   * Returns results for all hooks (including failures).
   *
   * Non-blocking hooks (default) swallow errors. Blocking hooks propagate
   * errors by throwing after all hooks complete.
   */
  async emit(event: HookEvent, payload: Record<string, unknown> = {}): Promise<HookResult[]> {
    const hooks = this.getHooksForEvent(event);
    if (hooks.length === 0) return [];

    const eventData: HookEventData = {
      event,
      timestamp: new Date().toISOString(),
      payload,
    };

    const results = await Promise.all(hooks.map((hook) => this.executeHook(hook, eventData)));

    // Check for blocking hook failures
    const blockingFailures = results.filter((r, i) => !r.success && hooks[i].nonBlocking === false);
    if (blockingFailures.length > 0) {
      const messages = blockingFailures.map((r) => `${r.hookId}: ${r.error}`).join("; ");
      throw new HookExecutionError(`Blocking hook(s) failed: ${messages}`, blockingFailures);
    }

    return results;
  }

  /** Execute a single hook with timeout. */
  private async executeHook(hook: HookDefinition, eventData: HookEventData): Promise<HookResult> {
    const start = Date.now();
    const timeout = hook.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      let output: string;

      if (hook.type === "command") {
        output = await this.executeCommand(hook, eventData, timeout);
      } else if (hook.type === "http") {
        output = await this.executeHttp(hook, eventData, timeout);
      } else {
        throw new Error(`Unknown hook type: ${hook.type}`);
      }

      return {
        hookId: hook.id,
        success: true,
        output,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.onLog?.("warn", `Hook '${hook.id}' failed: ${error}`);

      return {
        hookId: hook.id,
        success: false,
        error,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Execute a command hook. Event data is piped to stdin as JSON. */
  private executeCommand(
    hook: HookDefinition,
    eventData: HookEventData,
    timeout: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "/bin/sh",
        ["-c", hook.command!],
        {
          cwd: hook.cwd ?? process.cwd(),
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
          env: {
            ...process.env,
            DOJOPS_HOOK_EVENT: eventData.event,
            DOJOPS_HOOK_ID: hook.id,
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `Command hook failed (exit ${(err as NodeJS.ErrnoException & { code?: number }).code}): ${stderr || err.message}`,
              ),
            );
          } else {
            resolve(stdout.trim());
          }
        },
      );

      // Pipe event data to stdin (ignore EPIPE if the process exits before reading)
      if (child.stdin) {
        child.stdin.on("error", () => {});
        child.stdin.write(JSON.stringify(eventData));
        child.stdin.end();
      }
    });
  }

  /** Execute an HTTP webhook. POSTs event data as JSON. */
  private async executeHttp(
    hook: HookDefinition,
    eventData: HookEventData,
    timeout: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(hook.url!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
        signal: controller.signal,
      });

      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
      }

      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Error thrown when blocking hooks fail. */
export class HookExecutionError extends Error {
  constructor(
    message: string,
    public readonly failures: HookResult[],
  ) {
    super(message);
    this.name = "HookExecutionError";
  }
}
