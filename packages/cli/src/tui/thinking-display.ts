/**
 * Extended thinking display matching Claude Code's ∴ indicator.
 *
 * During thinking:
 *   ∴ Thinking…          (animated: ∴ pulses dim↔bright, dots animate)
 *
 * After completion:
 *   ∴ thought for 5s     (static, dim)
 */
import pc from "picocolors";
import { Animator, formatDuration } from "./animator";

// ── Constants ───────────────────────────────────────────────────────

const THEREFORE = "∴";
const PULSE_PERIOD_FRAMES = 40; // 2 seconds at 50ms per frame

// ── ThinkingDisplay ─────────────────────────────────────────────────

export class ThinkingDisplay {
  private readonly animator: Animator;
  private startMs = 0;
  private active = false;
  private disposed = false;
  private previewText = "";

  constructor() {
    this.animator = new Animator();
  }

  /** Start the thinking animation. */
  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.startMs = Date.now();
    this.previewText = "";

    this.animator.start(() => this.render());
  }

  /**
   * Stop thinking and print the final duration line.
   * Returns the final line string.
   */
  stop(): string {
    if (!this.active) return "";
    this.active = false;
    this.animator.stop();

    const durationMs = Date.now() - this.startMs;
    const thoughtFor = `thought for ${formatDuration(durationMs)}`;
    const final = `${pc.dim(THEREFORE)} ${pc.dim(thoughtFor)}`;
    process.stdout.write(`${final}\n`);
    return final;
  }

  /** Update the preview text (first line of thinking content). */
  update(text: string): void {
    if (!this.active) return;
    const firstLine = text.split("\n")[0].trim();
    if (firstLine.length > 80) {
      this.previewText = firstLine.slice(0, 77) + "...";
    } else {
      this.previewText = firstLine;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  /** Clean up. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      this.active = false;
      this.animator.stop();
    }
    this.animator.dispose();
  }

  // ── Private ─────────────────────────────────────────────────────

  private render(): string[] {
    const frame = this.animator.currentFrame;

    // Pulse the ∴ symbol: bright → dim → bright over 2 seconds
    const phase = (frame % PULSE_PERIOD_FRAMES) / PULSE_PERIOD_FRAMES;
    const brightness = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
    const symbol = brightness > 0.5 ? pc.cyan(THEREFORE) : pc.dim(THEREFORE);

    // Animate dots: . → .. → ...
    const dotPhase = frame % 15;
    let dotCount: number;
    if (dotPhase < 5) {
      dotCount = 1;
    } else if (dotPhase < 10) {
      dotCount = 2;
    } else {
      dotCount = 3;
    }
    const dots = ".".repeat(dotCount);

    const thinkingText = `Thinking${dots}`;
    const label = `${symbol} ${pc.dim(thinkingText)}`;

    if (this.previewText) {
      return [label, `  ${pc.dim(this.previewText)}`];
    }
    return [label];
  }
}
