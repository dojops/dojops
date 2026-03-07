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
  if (process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR) {
    return new TTYProgressReporter(totalSteps);
  }
  return new PlainProgressReporter(totalSteps);
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
    console.log(`  [FAIL] ${stepId}${error ? `: ${error}` : ""}`);
  }

  done(): void {
    // no-op for plain output
  }
}

class TTYProgressReporter implements ProgressReporter {
  private completed = 0;
  private currentStep = "";

  constructor(private readonly total: number) {}

  start(stepId: string, description: string): void {
    this.currentStep = `${stepId}: ${description}`;
    this.render();
  }

  complete(stepId: string): void {
    this.clearLine();
    this.completed++;
    const pct = Math.round((this.completed / this.total) * 100);
    const pctLabel = pc.dim("(" + pct + "%)");
    console.log(`  ${pc.green("✓")} ${pc.blue(stepId)} ${pctLabel}`);
  }

  fail(stepId: string, error?: string): void {
    this.clearLine();
    this.completed++;
    const suffix = error ? " " + pc.dim(error) : "";
    console.log(`  ${pc.red("✗")} ${pc.blue(stepId)}${suffix}`);
  }

  done(): void {
    this.clearLine();
  }

  private render(): void {
    const pct = Math.round((this.completed / this.total) * 100);
    const barWidth = 20;
    const filled = Math.round((this.completed / this.total) * barWidth);
    const empty = barWidth - filled;
    const bar = pc.cyan("█".repeat(filled)) + pc.dim("░".repeat(empty));
    const line = `  ${bar} ${pct}% ${pc.dim(this.currentStep)}`;
    process.stdout.write(`\r${line}`);
  }

  private clearLine(): void {
    process.stdout.write("\r\x1b[K");
  }
}
