/**
 * Inline tool call display for agent loop execution.
 *
 * Shows animated indicator while a tool is running, then a static
 * result line when complete:
 *
 *   ⟳ read_file src/index.ts…          (running, animated)
 *   ✓ read_file (src/index.ts) 23ms     (completed, green)
 *   ✗ run_command (npm test) 1.2s       (failed, red)
 */
import pc from "picocolors";
import { Animator, cycleGlyph, isTTY, formatDuration } from "./animator";

// ── Constants ───────────────────────────────────────────────────────

const TOOL_SPINNER_GLYPHS = ["⟳", "⟲", "⟳", "⟲"];
const MAX_ARGS_LEN = 60;
const MAX_PREVIEW_LEN = 120;
const INDENT = "  ";

// ── ToolDisplay ─────────────────────────────────────────────────────

export interface ToolDisplayOptions {
  maxOutputPreview?: number;
  showTimings?: boolean;
}

interface ActiveTool {
  name: string;
  argsPreview: string;
  startMs: number;
}

export class ToolDisplay {
  private animator: Animator;
  private activeTool: ActiveTool | null = null;
  private maxPreview: number;
  private showTimings: boolean;
  private disposed = false;

  constructor(opts?: ToolDisplayOptions) {
    this.animator = new Animator();
    this.maxPreview = opts?.maxOutputPreview ?? MAX_PREVIEW_LEN;
    this.showTimings = opts?.showTimings !== false;
  }

  /** Show animated indicator for a running tool. */
  toolStart(name: string, argsPreview: string): void {
    if (this.disposed) return;

    // If a previous tool was running, stop its animation first
    if (this.activeTool) {
      this.animator.stop();
    }

    const truncatedArgs =
      argsPreview.length > MAX_ARGS_LEN
        ? argsPreview.slice(0, MAX_ARGS_LEN - 1) + "…"
        : argsPreview;

    this.activeTool = { name, argsPreview: truncatedArgs, startMs: Date.now() };

    if (!isTTY()) {
      process.stdout.write(
        `${INDENT}${pc.yellow("⟳")} ${pc.cyan(name)} ${pc.dim(truncatedArgs)}\n`,
      );
      return;
    }

    this.animator.start(() => this.renderRunning());
  }

  /** Show completed tool result (static line). */
  toolComplete(name: string, durationMs: number, isError: boolean, preview?: string): void {
    if (this.disposed) return;

    // Stop any running animation
    this.animator.stop();

    const args = this.activeTool?.argsPreview ?? "";
    this.activeTool = null;

    const icon = isError ? pc.red("✗") : pc.green("✓");
    const toolName = isError ? pc.red(name) : name;
    const timing = this.showTimings ? pc.dim(` ${formatDuration(durationMs)}`) : "";
    const argsStr = args ? pc.dim(` (${args})`) : "";

    let line = `${INDENT}${icon} ${toolName}${argsStr}${timing}`;

    if (preview) {
      const truncated = preview.split("\n")[0].slice(0, this.maxPreview);
      line += `\n${INDENT}  ${pc.dim(truncated)}`;
    }

    process.stdout.write(`${line}\n`);
  }

  /** Clean up. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animator.dispose();
    this.activeTool = null;
  }

  // ── Private ─────────────────────────────────────────────────────

  private renderRunning(): string[] {
    if (!this.activeTool) return [];

    const frame = this.animator.currentFrame;
    const glyph = pc.yellow(cycleGlyph(frame, TOOL_SPINNER_GLYPHS));
    const name = pc.cyan(this.activeTool.name);
    const args = pc.dim(this.activeTool.argsPreview);
    const dots = ".".repeat((frame % 3) + 1);

    return [`${INDENT}${glyph} ${name} ${args}${pc.dim(dots)}`];
  }
}
