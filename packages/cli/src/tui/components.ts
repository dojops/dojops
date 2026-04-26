/**
 * Rich TUI components for interactive chat mode.
 *
 * Lightweight component system inspired by Ink (React-for-terminal),
 * using raw ANSI codes + picocolors. No React dependency.
 *
 * Components:
 * - ToolCallPanel: live-updating tool execution status
 * - MessageBubble: formatted chat messages with role indicators
 * - ApprovalDialog: interactive approval prompt with file details
 * - ProgressBar: token usage and iteration progress
 */
import pc from "picocolors";

// ── Box drawing ──────────────────────────────────────────────────────

const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
} as const;

function boxLine(
  width: number,
  left: string,
  right: string,
  fill: string = BOX.horizontal,
): string {
  return `${left}${fill.repeat(width - 2)}${right}`;
}

function padLine(content: string, width: number): string {
  const stripped = stripAnsi(content);
  const pad = Math.max(0, width - stripped.length - 4);
  return `${BOX.vertical} ${content}${" ".repeat(pad)} ${BOX.vertical}`;
}

// ── ANSI helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replaceAll(ANSI_RE, "");
}

function termWidth(): number {
  return process.stdout.columns || 80;
}

// ── ToolCallPanel ────────────────────────────────────────────────────

export type ToolStatus = "running" | "success" | "error" | "skipped";

export interface ToolCallInfo {
  name: string;
  args?: string;
  status: ToolStatus;
  durationMs?: number;
  outputPreview?: string;
}

const STATUS_ICONS: Record<ToolStatus, string> = {
  running: pc.yellow("⟳"),
  success: pc.green("✓"),
  error: pc.red("✗"),
  skipped: pc.dim("⊘"),
};

/**
 * Render a tool call panel showing tool execution status.
 * Displays each tool with its status icon, name, and optional output preview.
 */
export function renderToolCallPanel(tools: ToolCallInfo[]): string {
  if (tools.length === 0) return "";

  const width = Math.min(termWidth(), 72);
  const lines: string[] = [];

  const toolCount = `(${tools.length})`;
  const header = `${pc.bold("Tool Calls")} ${pc.dim(toolCount)}`;
  lines.push(
    pc.dim(boxLine(width, BOX.topLeft, BOX.topRight)),
    pc.dim(padLine(header, width)),
    pc.dim(boxLine(width, BOX.teeRight, BOX.teeLeft)),
  );

  for (const tool of tools) {
    const icon = STATUS_ICONS[tool.status];
    const name = tool.status === "running" ? pc.yellow(tool.name) : tool.name;
    const duration = tool.durationMs ? pc.dim(` ${tool.durationMs}ms`) : "";
    const line = `${icon} ${name}${duration}`;
    lines.push(pc.dim(padLine(line, width)));

    if (tool.outputPreview) {
      const preview = tool.outputPreview.slice(0, width - 10);
      lines.push(pc.dim(padLine(`  ${pc.dim(preview)}`, width)));
    }
  }

  lines.push(pc.dim(boxLine(width, BOX.bottomLeft, BOX.bottomRight)));

  return lines.join("\n");
}

// ── MessageBubble ────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface MessageBubbleOptions {
  role: MessageRole;
  content: string;
  agent?: string;
  timestamp?: Date;
  tokenCount?: number;
}

const ROLE_INDICATORS: Record<MessageRole, string> = {
  user: pc.cyan("▸ You"),
  assistant: pc.green("◆ DojOps"),
  system: pc.dim("◇ System"),
  tool: pc.yellow("⚡ Tool"),
};

/**
 * Render a formatted chat message with role indicator.
 */
export function renderMessageBubble(opts: MessageBubbleOptions): string {
  const role = ROLE_INDICATORS[opts.role];
  const agent = opts.agent && opts.role === "assistant" ? pc.dim(` (${opts.agent})`) : "";
  const time = opts.timestamp ? pc.dim(` ${formatTime(opts.timestamp)}`) : "";
  const tokens = opts.tokenCount ? pc.dim(` [${opts.tokenCount} tokens]`) : "";

  const header = `${role}${agent}${time}${tokens}`;
  return `${header}\n${opts.content}`;
}

// ── ApprovalDialog ───────────────────────────────────────────────────

export interface ApprovalDialogOptions {
  taskId: string;
  skillName: string;
  summary: string;
  filesCreated: string[];
  filesModified: string[];
  risk: "low" | "medium" | "high";
}

const RISK_COLORS = {
  low: pc.green,
  medium: pc.yellow,
  high: pc.red,
};

/**
 * Render a rich approval dialog with file details and risk indicator.
 */
export function renderApprovalDialog(opts: ApprovalDialogOptions): string {
  const width = Math.min(termWidth(), 72);
  const lines: string[] = [];

  const riskColor = RISK_COLORS[opts.risk];
  const riskLabel = riskColor(`${opts.risk.toUpperCase()} RISK`);

  lines.push(
    pc.dim(boxLine(width, BOX.topLeft, BOX.topRight)),
    pc.dim(padLine(`${pc.bold("Approval Required")} ${riskLabel}`, width)),
    pc.dim(boxLine(width, BOX.teeRight, BOX.teeLeft)),
    pc.dim(padLine(`${pc.dim("Task:")}    ${opts.taskId}`, width)),
    pc.dim(padLine(`${pc.dim("Skill:")}   ${opts.skillName}`, width)),
    pc.dim(padLine(`${pc.dim("Summary:")} ${opts.summary.slice(0, width - 16)}`, width)),
  );

  if (opts.filesCreated.length > 0) {
    lines.push(
      pc.dim(padLine("", width)),
      pc.dim(padLine(pc.green(`Creates ${opts.filesCreated.length} file(s):`), width)),
    );
    for (const f of opts.filesCreated.slice(0, 5)) {
      lines.push(pc.dim(padLine(`  ${pc.green("+")} ${f}`, width)));
    }
    if (opts.filesCreated.length > 5) {
      lines.push(pc.dim(padLine(pc.dim(`  ... and ${opts.filesCreated.length - 5} more`), width)));
    }
  }

  if (opts.filesModified.length > 0) {
    lines.push(
      pc.dim(padLine("", width)),
      pc.dim(padLine(pc.yellow(`Modifies ${opts.filesModified.length} file(s):`), width)),
    );
    for (const f of opts.filesModified.slice(0, 5)) {
      lines.push(pc.dim(padLine(`  ${pc.yellow("~")} ${f}`, width)));
    }
    if (opts.filesModified.length > 5) {
      lines.push(pc.dim(padLine(pc.dim(`  ... and ${opts.filesModified.length - 5} more`), width)));
    }
  }

  lines.push(pc.dim(boxLine(width, BOX.bottomLeft, BOX.bottomRight)));

  return lines.join("\n");
}

// ── ProgressBar ──────────────────────────────────────────────────────

export interface ProgressBarOptions {
  label: string;
  current: number;
  total: number;
  width?: number;
  showPercent?: boolean;
}

/**
 * Render a compact progress bar with label and percentage.
 */
export function renderProgressBar(opts: ProgressBarOptions): string {
  const barWidth = opts.width ?? 30;
  const ratio = Math.min(1, Math.max(0, opts.current / opts.total));
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;

  const bar = pc.green("█".repeat(filled)) + pc.dim("░".repeat(empty));
  const pct = opts.showPercent === false ? "" : pc.dim(` ${Math.round(ratio * 100)}%`);
  const count = pc.dim(` ${opts.current}/${opts.total}`);

  return `${pc.dim(opts.label)} ${bar}${pct}${count}`;
}

// ── Agent iteration indicator ────────────────────────────────────────

export interface IterationIndicatorOptions {
  iteration: number;
  maxIterations: number;
  phase: string;
  agent: string;
  tokensUsed: number;
}

/**
 * Render a single-line iteration indicator for the agent loop.
 */
export function renderIterationIndicator(opts: IterationIndicatorOptions): string {
  const iter = pc.dim(`[${opts.iteration}/${opts.maxIterations}]`);
  const phase = pc.cyan(opts.phase);
  const agent = pc.magenta(opts.agent);
  const tokens = pc.dim(`${opts.tokensUsed.toLocaleString()} tokens`);

  return `${iter} ${phase} ${pc.dim("via")} ${agent} ${pc.dim("·")} ${tokens}`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}
