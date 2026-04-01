/**
 * Lifecycle events emitted by the dojops engine.
 * Hooks subscribe to these events to extend behavior.
 */
export type HookEvent =
  | "PreSkillGenerate"
  | "PostSkillGenerate"
  | "PreVerify"
  | "PostVerify"
  | "PreExecute"
  | "PostExecute"
  | "PreApproval"
  | "PromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "PlanCreated"
  | "TaskStart"
  | "TaskComplete"
  | "AuditEntry"
  | "AgentIteration"
  | "ScanComplete";

/** All valid hook events. */
export const HOOK_EVENTS: HookEvent[] = [
  "PreSkillGenerate",
  "PostSkillGenerate",
  "PreVerify",
  "PostVerify",
  "PreExecute",
  "PostExecute",
  "PreApproval",
  "PromptSubmit",
  "SessionStart",
  "SessionEnd",
  "PlanCreated",
  "TaskStart",
  "TaskComplete",
  "AuditEntry",
  "AgentIteration",
  "ScanComplete",
];

/** How the hook is executed. */
export type HookExecutionType = "command" | "http";

/** Data passed to hooks when an event fires. */
export interface HookEventData {
  /** Which event fired. */
  event: HookEvent;
  /** ISO timestamp of when the event occurred. */
  timestamp: string;
  /** Arbitrary event-specific payload. */
  payload: Record<string, unknown>;
}

/** Result from a single hook execution. */
export interface HookResult {
  /** The hook that was executed. */
  hookId: string;
  /** Whether the hook succeeded. */
  success: boolean;
  /** Output from the hook (stdout for commands, response body for HTTP). */
  output?: string;
  /** Error message if the hook failed. */
  error?: string;
  /** Duration in milliseconds. */
  durationMs: number;
}

/**
 * A single hook definition.
 * Each hook subscribes to one or more events and specifies how to execute.
 */
export interface HookDefinition {
  /** Unique identifier for this hook. */
  id: string;
  /** Human-readable name. */
  name?: string;
  /** Which events trigger this hook. */
  events: HookEvent[];
  /** Execution type. */
  type: HookExecutionType;
  /** For "command" type: the shell command to run. Event data is passed as JSON via stdin. */
  command?: string;
  /** For "http" type: the URL to POST to. Event data is the JSON body. */
  url?: string;
  /** Timeout in milliseconds (default: 10000). */
  timeoutMs?: number;
  /** If true, errors in this hook do not propagate (default: true). */
  nonBlocking?: boolean;
  /** If true, this hook is disabled. */
  disabled?: boolean;
  /** Working directory for command execution (default: process.cwd()). */
  cwd?: string;
}

/** Configuration object for hooks, typically loaded from .dojops/hooks.json. */
export interface HookConfig {
  hooks: HookDefinition[];
}
