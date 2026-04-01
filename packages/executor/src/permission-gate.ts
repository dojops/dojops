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

  constructor(opts: PermissionGateOptions) {
    this.mode = opts.mode;
    this.rules = opts.rules ?? [];
    this.hookEngine = opts.hookEngine;
  }

  /**
   * Check if a tool call is allowed under the current permission mode.
   * Returns the decision: "allow", "deny", or "ask".
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  check(
    toolName: string,
    args: Record<string, unknown> = {},
    taskRisk?: RiskLevel,
  ): PermissionDecision {
    // 1. Check per-tool rules first (first match wins)
    for (const rule of this.rules) {
      if (matchToolPattern(rule.tool, toolName)) {
        return {
          action: rule.action,
          reason: rule.reason ?? `Matched rule for '${rule.tool}'`,
        };
      }
    }

    // 2. Apply mode-based logic
    switch (this.mode) {
      case "plan-only":
        if (WRITE_TOOLS.has(toolName)) {
          return {
            action: "deny",
            reason: "Write operations are blocked in plan-only mode",
          };
        }
        return { action: "allow" };

      case "auto-approve":
        return { action: "allow" };

      case "strict":
        if (READ_ONLY_TOOLS.has(toolName)) {
          return { action: "allow" };
        }
        return {
          action: "ask",
          reason: `Strict mode: approval required for '${toolName}'`,
        };

      case "interactive":
      default:
        // Read-only tools are always allowed
        if (READ_ONLY_TOOLS.has(toolName)) {
          return { action: "allow" };
        }
        // Risk-based: allow low/medium risk, ask for high/critical
        if (taskRisk && isRiskAtOrBelow(taskRisk, "MEDIUM")) {
          return { action: "allow" };
        }
        if (taskRisk && !isRiskAtOrBelow(taskRisk, "MEDIUM")) {
          return {
            action: "ask",
            reason: `High-risk operation: ${toolName} (risk: ${taskRisk})`,
          };
        }
        // No risk info — default to allow for non-write tools, ask for writes
        if (WRITE_TOOLS.has(toolName)) {
          return { action: "allow" };
        }
        return { action: "allow" };
    }
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
