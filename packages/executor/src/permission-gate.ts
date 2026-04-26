import type { ExecutionPolicy, RiskLevel } from "./types";
import { isRiskAtOrBelow } from "./types";
import { PolicyViolationError } from "./policy";
import type { HookEmitter } from "./safe-executor";

/**
 * Permission modes control how the executor handles approval.
 *
 * - interactive: ask the user for risky operations (default, maps to approvalMode: "risk-based")
 * - auto-approve: approve everything automatically (maps to approvalMode: "never", like --yes)
 * - plan-only: block all writes and executions (read-only exploration mode)
 * - strict: require explicit approval for every operation (maps to approvalMode: "always")
 */
export type PermissionMode = "interactive" | "auto-approve" | "plan-only" | "strict";

/** A per-tool permission rule (allow, deny, or ask). */
export interface PermissionRule {
  /** Glob pattern matching tool names (e.g. "write_file", "run_command", "*"). */
  tool: string;
  /** Action when the tool is invoked. */
  action: "allow" | "deny" | "ask";
  /** Optional reason shown to the user when denied or when asking. */
  reason?: string;
}

export interface PermissionGateOptions {
  /** The active permission mode. */
  mode: PermissionMode;
  /** Per-tool rules (evaluated in order, first match wins). */
  rules?: PermissionRule[];
  /** Hook engine for PreApproval events. */
  hookEngine?: HookEmitter;
  /** Policy used for write path checks. */
  policy?: ExecutionPolicy;
}

/** Tools that are always safe in any mode (read-only operations). */
const READ_ONLY_TOOLS = new Set(["read_file", "search_files", "list_files", "search_skills"]);

/** Tools that modify state (require permission in strict/plan-only modes). */
const WRITE_TOOLS = new Set(["write_file", "edit_file", "run_command", "run_skill"]);

/**
 * PermissionGate evaluates whether a tool call should proceed, be blocked,
 * or require user confirmation. It layers permission modes on top of the
 * existing policy system.
 */
export class PermissionGate {
  private readonly mode: PermissionMode;
  private readonly rules: PermissionRule[];
  private readonly hookEngine: HookEmitter | undefined;

  /** Tracks consecutive denials per tool to prevent infinite retry loops. */
  private readonly denialCounts: Map<string, number> = new Map();
  private static readonly DENIAL_THRESHOLD = 3;

  constructor(opts: PermissionGateOptions) {
    this.mode = opts.mode;
    this.rules = opts.rules ?? [];
    this.hookEngine = opts.hookEngine;
  }

  /**
   * Record a denial for a tool. Returns true if the denial threshold has been reached.
   */
  private recordDenial(toolName: string): boolean {
    const count = (this.denialCounts.get(toolName) ?? 0) + 1;
    this.denialCounts.set(toolName, count);
    return count >= PermissionGate.DENIAL_THRESHOLD;
  }

  /**
   * Reset denial count for a tool (called when it gets allowed).
   */
  private resetDenials(toolName: string): void {
    this.denialCounts.delete(toolName);
  }

  /**
   * Check if a tool has been denied too many times and should be auto-skipped.
   */
  isAutoBlocked(toolName: string): boolean {
    return (this.denialCounts.get(toolName) ?? 0) >= PermissionGate.DENIAL_THRESHOLD;
  }

  /**
   * Get denial info for reporting.
   */
  getDenialInfo(): { tool: string; count: number }[] {
    return [...this.denialCounts.entries()]
      .filter(([, count]) => count > 0)
      .map(([tool, count]) => ({ tool, count }));
  }

  /**
   * Record an external denial for a tool (e.g., when an "ask" decision is
   * answered with "deny" by the user/caller). Returns true if the tool is
   * now auto-blocked.
   */
  recordExternalDenial(toolName: string): boolean {
    return this.recordDenial(toolName);
  }

  /**
   * Record an external allow for a tool (e.g., when an "ask" decision is
   * answered with "allow" by the user/caller). Resets the denial counter.
   */
  recordExternalAllow(toolName: string): void {
    this.resetDenials(toolName);
  }

  /**
   * Check if a tool call is allowed under the current permission mode.
   * Returns the decision: "allow", "deny", or "ask".
   */
  check(
    toolName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    args: Record<string, unknown> = {},
    taskRisk?: RiskLevel,
  ): PermissionDecision {
    // 0. Auto-block tools that have been denied too many times
    if (this.isAutoBlocked(toolName)) {
      return {
        action: "deny",
        reason: `Tool "${toolName}" auto-blocked after ${PermissionGate.DENIAL_THRESHOLD} consecutive denials`,
      };
    }

    // 1. Check per-tool rules first (first match wins)
    for (const rule of this.rules) {
      if (matchToolPattern(rule.tool, toolName)) {
        const decision: PermissionDecision = {
          action: rule.action,
          reason: rule.reason ?? `Matched rule for '${rule.tool}'`,
        };
        this.trackDenialState(toolName, decision);
        return decision;
      }
    }

    // 2. Apply mode-based logic
    const decision = this.decideByMode(toolName, taskRisk);
    this.trackDenialState(toolName, decision);
    return decision;
  }

  /** Resolve the permission decision based on the active mode. */
  private decideByMode(toolName: string, taskRisk?: RiskLevel): PermissionDecision {
    switch (this.mode) {
      case "plan-only":
        return decidePlanOnly(toolName);
      case "auto-approve":
        return { action: "allow" };
      case "strict":
        return decideStrict(toolName);
      case "interactive":
      default:
        return decideInteractive(toolName, taskRisk);
    }
  }

  /** Update denial tracking based on a permission decision. */
  private trackDenialState(toolName: string, decision: PermissionDecision): void {
    if (decision.action === "deny") {
      this.recordDenial(toolName);
    } else if (decision.action === "allow") {
      this.resetDenials(toolName);
    }
    // "ask" decisions don't update denial counts — the caller decides allow/deny
  }

  /**
   * Enforce permission check — throws PolicyViolationError on denial.
   * Emits PreApproval hook before returning "ask" decisions.
   */
  async enforce(
    toolName: string,
    args: Record<string, unknown> = {},
    taskRisk?: RiskLevel,
  ): Promise<PermissionDecision> {
    const decision = this.check(toolName, args, taskRisk);

    if (decision.action === "deny") {
      throw new PolicyViolationError(
        decision.reason ?? `Tool '${toolName}' denied by permission gate`,
        "permissionGate",
      );
    }

    if (decision.action === "ask") {
      this.hookEngine
        ?.emit("PreApproval", { tool: toolName, risk: taskRisk, reason: decision.reason })
        .catch(() => {});
    }

    return decision;
  }

  /** Get the current permission mode. */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Map a PermissionMode to the equivalent ExecutionPolicy overrides.
   * Useful when creating a SafeExecutor with mode-appropriate settings.
   */
  static toPolicyOverrides(mode: PermissionMode): Partial<ExecutionPolicy> {
    switch (mode) {
      case "plan-only":
        return {
          allowWrite: false,
          requireApproval: true,
          approvalMode: "always",
        };
      case "auto-approve":
        return {
          allowWrite: true,
          requireApproval: false,
          approvalMode: "never",
        };
      case "strict":
        return {
          allowWrite: true,
          requireApproval: true,
          approvalMode: "always",
        };
      case "interactive":
      default:
        return {
          allowWrite: true,
          requireApproval: true,
          approvalMode: "risk-based",
        };
    }
  }
}

export interface PermissionDecision {
  action: "allow" | "deny" | "ask";
  reason?: string;
}

/** Resolve permission for plan-only mode: deny writes, allow reads. */
function decidePlanOnly(toolName: string): PermissionDecision {
  if (WRITE_TOOLS.has(toolName)) {
    return { action: "deny", reason: "Write operations are blocked in plan-only mode" };
  }
  return { action: "allow" };
}

/** Resolve permission for strict mode: allow reads, ask for everything else. */
function decideStrict(toolName: string): PermissionDecision {
  if (READ_ONLY_TOOLS.has(toolName)) return { action: "allow" };
  return { action: "ask", reason: `Strict mode: approval required for '${toolName}'` };
}

/** Resolve permission for interactive mode: risk-based decision on writes. */
function decideInteractive(toolName: string, taskRisk?: RiskLevel): PermissionDecision {
  if (READ_ONLY_TOOLS.has(toolName)) return { action: "allow" };
  const isHighRisk = taskRisk && !isRiskAtOrBelow(taskRisk, "MEDIUM");
  if (isHighRisk) {
    return { action: "ask", reason: `High-risk operation: ${toolName} (risk: ${taskRisk})` };
  }
  return { action: "allow" };
}

/** Match a tool name against a pattern (supports "*" wildcard). */
function matchToolPattern(pattern: string, toolName: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;
  // Simple prefix wildcard (e.g. "run_*" matches "run_command", "run_skill")
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return false;
}
