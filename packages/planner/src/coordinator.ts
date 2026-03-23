/**
 * AgentCoordinator — inter-task coordination for planner execution.
 *
 * Provides shared context, message passing, and handoff queues so tasks
 * in a plan can discover and share information across waves without
 * requiring direct dependency links.
 */

export interface SharedContextEntry {
  key: string;
  value: unknown;
  source: string;
  timestamp: number;
}

export interface CoordinatorMessage {
  from: string;
  to: string; // taskId or "*" for broadcast
  type: "info" | "request" | "handoff";
  payload: unknown;
}

export interface HandoffRequest {
  from: string;
  to: string;
  reason: string;
  partialOutput: unknown;
}

export interface CoordinatorSnapshot {
  contextKeys: string[];
  pendingMessages: number;
  pendingHandoffs: number;
}

export class AgentCoordinator {
  private context = new Map<string, SharedContextEntry>();
  private inbox = new Map<string, CoordinatorMessage[]>();
  private handoffs: HandoffRequest[] = [];

  /** Set a shared context value visible to all tasks. */
  set(key: string, value: unknown, source: string): void {
    this.context.set(key, { key, value, source, timestamp: Date.now() });
  }

  /** Get a shared context value. */
  get(key: string): unknown | undefined {
    return this.context.get(key)?.value;
  }

  /** Get all context entries. */
  getAll(): Map<string, SharedContextEntry> {
    return new Map(this.context);
  }

  /** Send a message to a specific task or broadcast to all registered inboxes. */
  send(message: CoordinatorMessage): void {
    if (message.to === "*") {
      for (const [, msgs] of this.inbox) {
        msgs.push(message);
      }
    } else {
      if (!this.inbox.has(message.to)) {
        this.inbox.set(message.to, []);
      }
      this.inbox.get(message.to)!.push(message);
    }
  }

  /** Ensure an inbox exists for a task (call before send to enable broadcast). */
  register(taskId: string): void {
    if (!this.inbox.has(taskId)) {
      this.inbox.set(taskId, []);
    }
  }

  /** Drain messages for a task. Returns and clears the inbox. */
  drain(taskId: string): CoordinatorMessage[] {
    const messages = this.inbox.get(taskId) ?? [];
    this.inbox.delete(taskId);
    return messages;
  }

  /** Request a handoff from one task to another. */
  requestHandoff(request: HandoffRequest): void {
    this.handoffs.push(request);
  }

  /** Drain pending handoffs targeting a specific task. */
  drainHandoffs(targetTaskId: string): HandoffRequest[] {
    const matching = this.handoffs.filter((h) => h.to === targetTaskId);
    this.handoffs = this.handoffs.filter((h) => h.to !== targetTaskId);
    return matching;
  }

  /** Snapshot for debugging/audit. */
  snapshot(): CoordinatorSnapshot {
    let msgCount = 0;
    for (const msgs of this.inbox.values()) {
      msgCount += msgs.length;
    }
    return {
      contextKeys: [...this.context.keys()],
      pendingMessages: msgCount,
      pendingHandoffs: this.handoffs.length,
    };
  }
}
