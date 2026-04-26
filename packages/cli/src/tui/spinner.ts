/**
 * LLM generation spinner matching Claude Code's visual style.
 *
 * Displays an animated line during LLM generation:
 *   ✢ Thinking… · 00:02 · ↓ 320 tokens
 *
 * Features:
 * - Glyph cycling (·✢✳✶✻✽) at 50ms intervals
 * - Random verb from a pool of ~30 verbs
 * - Elapsed timer
 * - Live token counter with smooth increment
 * - Stall detection (spinner turns red after 3s with no tokens)
 * - Shimmer wave effect on the verb text
 */
import pc from "picocolors";
import {
  Animator,
  SPINNER_GLYPHS,
  cycleGlyph,
  shimmerLine,
  formatElapsed,
  formatTokenCount,
} from "./animator";

// ── Verb pool ───────────────────────────────────────────────────────

const VERB_POOL = [
  "Thinking",
  "Reasoning",
  "Processing",
  "Analyzing",
  "Computing",
  "Considering",
  "Evaluating",
  "Generating",
  "Composing",
  "Crafting",
  "Synthesizing",
  "Examining",
  "Calculating",
  "Reflecting",
  "Working",
  "Pondering",
  "Deliberating",
  "Formulating",
  "Resolving",
  "Deducing",
  "Preparing",
  "Building",
  "Assembling",
  "Mapping",
  "Structuring",
  "Interpreting",
  "Weighing",
  "Investigating",
  "Contemplating",
  "Orchestrating",
];

function randomVerb(): string {
  // NOSONAR — Math.random is fine here: cosmetic spinner verb selection, no security context
  return VERB_POOL[Math.floor(Math.random() * VERB_POOL.length)]; // NOSONAR
}

// ── Stall thresholds ────────────────────────────────────────────────

const STALL_WARN_MS = 3000;

// ── Smooth token counter ────────────────────────────────────────────

function smoothIncrement(displayed: number, actual: number): number {
  const gap = actual - displayed;
  if (gap <= 0) return displayed;
  if (gap < 70) return displayed + Math.min(3, gap);
  if (gap < 200) return displayed + Math.ceil(gap * 0.15);
  return displayed + Math.ceil(gap * 0.5);
}

// ── LLMSpinner ──────────────────────────────────────────────────────

export interface LLMSpinnerOptions {
  model?: string;
}

export class LLMSpinner {
  private readonly animator: Animator;
  private verb = "";
  private agentName = "";
  private readonly model: string;

  private startMs = 0;
  private actualTokens = 0;
  private displayedTokens = 0;
  private lastTokenMs = 0;
  private active = false;

  constructor(opts?: LLMSpinnerOptions) {
    this.animator = new Animator();
    this.model = opts?.model ?? "";
  }

  /** Begin the spinner animation. Picks a random verb. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.startMs = Date.now();
    this.lastTokenMs = Date.now();
    this.actualTokens = 0;
    this.displayedTokens = 0;

    if (!this.verb) {
      this.verb = randomVerb();
    }

    this.animator.start(() => this.render());
  }

  /** Stop the spinner, clear the animated line. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.animator.stop();
  }

  /** Set a specific verb, or pick a random one if none provided. */
  setVerb(verb?: string): void {
    this.verb = verb ?? randomVerb();
  }

  /** Set the agent name displayed alongside the verb. */
  setAgent(name: string): void {
    this.agentName = name;
  }

  /** Increment the token counter. */
  incrementTokens(count = 1): void {
    this.actualTokens += count;
    this.lastTokenMs = Date.now();
  }

  /** Permanently stop and clean up. */
  dispose(): void {
    this.active = false;
    this.animator.dispose();
  }

  get isActive(): boolean {
    return this.active;
  }

  // ── Private ─────────────────────────────────────────────────────

  private render(): string[] {
    const frame = this.animator.currentFrame;

    // Smooth token counter
    this.displayedTokens = smoothIncrement(this.displayedTokens, this.actualTokens);

    // Stall detection
    const timeSinceToken = Date.now() - this.lastTokenMs;
    const isStalled = timeSinceToken > STALL_WARN_MS;

    // Glyph
    const glyphChar = cycleGlyph(frame, SPINNER_GLYPHS);
    const glyph = isStalled ? pc.red(glyphChar) : pc.cyan(glyphChar);

    // Verb with shimmer
    const verbText = `${this.verb}…`;
    const verb = isStalled ? pc.red(verbText) : shimmerLine(verbText, frame, pc.dim, pc.cyan);

    // Agent badge (if set)
    const agent = this.agentName ? ` ${pc.magenta(this.agentName)}` : "";

    // Timer
    const timer = pc.dim(formatElapsed(this.startMs));

    // Token count
    const tokens =
      this.displayedTokens > 0 ? pc.dim(formatTokenCount(Math.round(this.displayedTokens))) : "";

    // Compose: glyph verb · timer · tokens
    const parts = [`${glyph} ${verb}${agent}`, timer, tokens].filter(Boolean);

    return [parts.join(pc.dim(" · "))];
  }
}

/**
 * Create a spinner suitable for non-streaming operations.
 * In non-TTY mode, prints a static line. In TTY mode, animates.
 */
export function createSpinner(opts?: LLMSpinnerOptions): LLMSpinner {
  return new LLMSpinner(opts);
}
