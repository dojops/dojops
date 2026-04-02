/**
 * Animation engine for the dojops TUI.
 *
 * Drives all animated rendering (spinners, shimmer, task trees) via a single
 * setInterval at 50ms (20 FPS). Handles multi-line overwrite using ANSI
 * cursor control sequences, batched into a single stdout.write per frame.
 */
import pc from "picocolors";

// ── Constants ───────────────────────────────────────────────────────

const FRAME_INTERVAL_MS = 50;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[K";

// ── TTY guard ───────────────────────────────────────────────────────

/** Returns true if stdout is an interactive terminal (not CI, not piped). */
export function isTTY(): boolean {
  return !!(process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR);
}

// ── Animator ────────────────────────────────────────────────────────

export type RenderFn = () => string[];

export class Animator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastLineCount = 0;
  private renderFn: RenderFn | null = null;
  private frame = 0;
  private disposed = false;

  /** Current animation frame counter (increments every 50ms). */
  get currentFrame(): number {
    return this.frame;
  }

  /**
   * Start the animation loop. Each tick calls renderFn() to get lines,
   * then overwrites the previous frame in-place.
   */
  start(renderFn: RenderFn): void {
    if (this.disposed) return;
    this.renderFn = renderFn;
    this.frame = 0;

    if (!isTTY()) {
      // Non-TTY: render once statically
      const lines = renderFn();
      if (lines.length > 0) {
        process.stdout.write(lines.join("\n") + "\n");
      }
      this.lastLineCount = lines.length;
      return;
    }

    // Hide cursor during animation
    process.stdout.write(HIDE_CURSOR);

    // Render first frame immediately
    this.renderFrame();

    this.timer = setInterval(() => {
      this.frame++;
      this.renderFrame();
    }, FRAME_INTERVAL_MS);
  }

  /** Stop the animation, clear the rendered region, restore cursor. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!isTTY()) {
      // Non-TTY: clear with carriage return
      if (this.lastLineCount > 0) {
        process.stdout.write(`\r${CLEAR_LINE}`);
      }
      this.lastLineCount = 0;
      return;
    }

    // Clear the animated region
    this.clearRegion();
    process.stdout.write(SHOW_CURSOR);
    this.lastLineCount = 0;
    this.renderFn = null;
  }

  /** Force a single render outside the timer (useful before stop). */
  forceRender(): void {
    if (this.renderFn && isTTY()) {
      this.renderFrame();
    }
  }

  /** Stop and mark as permanently disposed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  // ── Private ─────────────────────────────────────────────────────

  private renderFrame(): void {
    if (!this.renderFn) return;

    const lines = this.renderFn();
    const buf: string[] = [];

    // Move cursor up to overwrite previous frame
    if (this.lastLineCount > 0) {
      buf.push(`\x1b[${this.lastLineCount}A`);
    }

    // Write each line (clear to end of line first)
    for (const line of lines) {
      buf.push(`${CLEAR_LINE}${line}\n`);
    }

    // If previous frame had more lines, clear the extras
    for (let i = lines.length; i < this.lastLineCount; i++) {
      buf.push(`${CLEAR_LINE}\n`);
    }

    // Batch write
    process.stdout.write(buf.join(""));
    this.lastLineCount = lines.length;
  }

  private clearRegion(): void {
    if (this.lastLineCount === 0) return;

    const buf: string[] = [];
    buf.push(`\x1b[${this.lastLineCount}A`);
    for (let i = 0; i < this.lastLineCount; i++) {
      buf.push(`${CLEAR_LINE}\n`);
    }
    // Move back up after clearing
    if (this.lastLineCount > 0) {
      buf.push(`\x1b[${this.lastLineCount}A`);
    }
    process.stdout.write(buf.join(""));
  }
}

// ── Animation utilities ─────────────────────────────────────────────

/** Spinner glyph set matching Claude Code. */
export const SPINNER_GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];

/** Cycle through a glyph array based on frame counter. */
export function cycleGlyph(frame: number, glyphs: string[] = SPINNER_GLYPHS): string {
  return glyphs[frame % glyphs.length];
}

/**
 * Apply a left-to-right shimmer effect to text.
 * Characters near the shimmer position get the highlight color,
 * others get the base color. Wavelength is 8 characters.
 */
export function shimmerLine(
  text: string,
  frame: number,
  baseColor: (s: string) => string = pc.dim,
  highlightColor: (s: string) => string = pc.cyan,
): string {
  const wavelength = 8;
  const cycleLen = text.length + wavelength * 2;
  const pos = (frame * 2) % cycleLen; // shimmer moves 2 chars per frame

  let result = "";
  for (let i = 0; i < text.length; i++) {
    const dist = Math.abs(i - (pos - wavelength));
    if (dist <= 1) {
      result += highlightColor(text[i]);
    } else if (dist <= 3) {
      result += pc.white(text[i]);
    } else {
      result += baseColor(text[i]);
    }
  }
  return result;
}

/** Format elapsed milliseconds as "MM:SS" or "H:MM:SS". */
export function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Format token count with ↓ prefix and K suffix for large numbers. */
export function formatTokenCount(count: number): string {
  if (count === 0) return "";
  if (count < 1000) return `↓ ${count} tokens`;
  const k = (count / 1000).toFixed(1).replace(/\.0$/, "");
  return `↓ ${k}K tokens`;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI escape codes for length calculation. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Format duration from ms: "23ms", "1.2s", "1:23". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}
