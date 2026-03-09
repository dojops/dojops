/**
 * Smart progress reporter for multi-step CLI operations.
 *
 * TTY-aware: shows inline progress bar on TTY, plain log lines on non-TTY/CI.
 */

import pc from "picocolors";

export interface ProgressReporter {
  /** Signal that a step has started. */
  start(stepId: string, description: string): void;
  /** Signal that a step has completed. */
  complete(stepId: string): void;
  /** Signal that a step has failed. */
  fail(stepId: string, error?: string): void;
  /** Clean up (clear progress line if needed). */
  done(): void;
}

/** Create a progress reporter that adapts to TTY vs non-TTY output. */
export function createProgressReporter(totalSteps: number): ProgressReporter {
  const safeTotal = Math.max(totalSteps, 1);
  if (process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR) {
    return new TTYProgressReporter(safeTotal);
  }
  return new PlainProgressReporter(safeTotal);
}

class PlainProgressReporter implements ProgressReporter {
  private completed = 0;
  constructor(private readonly total: number) {}

  start(stepId: string, description: string): void {
    const pct = Math.round((this.completed / this.total) * 100);
    console.log(`  [${pct}%] ${stepId}: ${description}`);
  }

  complete(stepId: string): void {
    this.completed++;
    const pct = Math.round((this.completed / this.total) * 100);
    console.log(`  [${pct}%] ${stepId}: done`);
  }

  fail(stepId: string, error?: string): void {
    this.completed++;
    const suffix = error ? ": " + error : "";
    console.log(`  [FAIL] ${stepId}${suffix}`);
  }

  done(): void {
    // no-op for plain output
  }
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class TTYProgressReporter implements ProgressReporter {
  private completed = 0;
  private currentStep = "";
  private spinnerIndex = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly total: number) {}

  start(stepId: string, description: string): void {
    this.currentStep = `${stepId}: ${description}`;
    this.render();
    this.startSpinner();
  }

  complete(stepId: string): void {
    this.stopSpinner();
    this.clearLine();
    this.completed++;
    const pct = Math.round((this.completed / this.total) * 100);
    const pctLabel = pc.dim("(" + pct + "%)");
    console.log(`  ${pc.green("✓")} ${pc.blue(stepId)} ${pctLabel}`);
  }

  fail(stepId: string, error?: string): void {
    this.stopSpinner();
    this.clearLine();
    this.completed++;
    const suffix = error ? " " + pc.dim(error) : "";
    console.log(`  ${pc.red("✗")} ${pc.blue(stepId)}${suffix}`);
  }

  done(): void {
    this.stopSpinner();
    this.clearLine();
  }

  private startSpinner(): void {
    this.stopSpinner();
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  private render(): void {
    const spinner = pc.cyan(SPINNER_FRAMES[this.spinnerIndex]);
    const termWidth = process.stdout.columns || 80;
    const progress = `[${this.completed + 1}/${this.total}]`;
    const label = this.currentStep;
    // Reserve space for prefix: "  ⠋ [1/3] "
    const prefixLen = progress.length + 6;
    const maxLabel = Math.max(termWidth - prefixLen, 20);
    const truncated = label.length > maxLabel ? label.slice(0, maxLabel - 1) + "…" : label;
    const line = `  ${spinner} ${pc.yellow(progress)} ${pc.dim(truncated)}`;
    process.stdout.write(`\r\x1b[K${line}`);
  }

  private clearLine(): void {
    process.stdout.write("\r\x1b[K");
  }
}
