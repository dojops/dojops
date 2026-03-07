import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProgressReporter } from "../progress";

describe("createProgressReporter", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("PlainProgressReporter (non-TTY)", () => {
    it("logs start with 0% initially", () => {
      const reporter = createProgressReporter(3);
      reporter.start("step-1", "Building");
      expect(consoleSpy).toHaveBeenCalledWith("  [0%] step-1: Building");
    });

    it("logs complete with incremented percentage", () => {
      const reporter = createProgressReporter(2);
      reporter.complete("step-1");
      expect(consoleSpy).toHaveBeenCalledWith("  [50%] step-1: done");
    });

    it("logs fail with FAIL prefix", () => {
      const reporter = createProgressReporter(2);
      reporter.fail("step-1", "something broke");
      expect(consoleSpy).toHaveBeenCalledWith("  [FAIL] step-1: something broke");
    });

    it("logs fail without error message", () => {
      const reporter = createProgressReporter(2);
      reporter.fail("step-1");
      expect(consoleSpy).toHaveBeenCalledWith("  [FAIL] step-1");
    });

    it("tracks progress through multiple steps", () => {
      const reporter = createProgressReporter(4);
      reporter.start("a", "first");
      reporter.complete("a");
      reporter.start("b", "second");
      reporter.complete("b");

      // After 2 of 4 completed, start should show 50%
      reporter.start("c", "third");
      expect(consoleSpy).toHaveBeenCalledWith("  [50%] c: third");
    });

    it("done is a no-op", () => {
      const reporter = createProgressReporter(1);
      reporter.done();
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe("TTYProgressReporter (TTY mode)", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;
    let origIsTTY: boolean | undefined;
    let origCI: string | undefined;
    let origNoColor: string | undefined;

    beforeEach(() => {
      // Save originals
      origIsTTY = process.stdout.isTTY;
      origCI = process.env.CI;
      origNoColor = process.env.NO_COLOR;

      // Force TTY mode
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      delete process.env.CI;
      delete process.env.NO_COLOR;

      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
      writeSpy.mockRestore();

      // Restore originals
      if (origIsTTY === undefined) {
        Object.defineProperty(process.stdout, "isTTY", {
          value: undefined,
          writable: true,
          configurable: true,
        });
      } else {
        Object.defineProperty(process.stdout, "isTTY", {
          value: origIsTTY,
          writable: true,
          configurable: true,
        });
      }
      if (origCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = origCI;
      }
      if (origNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = origNoColor;
      }
    });

    it("start() renders a progress bar via stdout.write", () => {
      const reporter = createProgressReporter(4);
      reporter.start("build", "Compiling");

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = writeSpy.mock.calls[0][0] as string;
      // Starts with carriage return
      expect(output).toMatch(/^\r/);
      // Contains the percentage (0% since nothing completed yet)
      expect(output).toContain("0%");
      // Contains the step description
      expect(output).toContain("build: Compiling");
    });

    it("complete() clears line, logs green checkmark with percentage", () => {
      const reporter = createProgressReporter(2);
      reporter.complete("step-1");

      // First call: clearLine (\r\x1b[K), second would be via console.log
      expect(writeSpy).toHaveBeenCalled();
      const clearCall = writeSpy.mock.calls[0][0] as string;
      expect(clearCall).toBe("\r\x1b[K");

      // console.log should have the checkmark and step id
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      expect(logOutput).toContain("✓");
      expect(logOutput).toContain("step-1");
      expect(logOutput).toContain("50%");
    });

    it("complete() tracks progress through multiple steps", () => {
      const reporter = createProgressReporter(4);

      reporter.complete("a");
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0][0] as string).toContain("25%");

      reporter.complete("b");
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy.mock.calls[1][0] as string).toContain("50%");

      reporter.complete("c");
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      expect(consoleSpy.mock.calls[2][0] as string).toContain("75%");

      reporter.complete("d");
      expect(consoleSpy).toHaveBeenCalledTimes(4);
      expect(consoleSpy.mock.calls[3][0] as string).toContain("100%");
    });

    it("fail() clears line and logs red X with step id", () => {
      const reporter = createProgressReporter(2);
      reporter.fail("deploy", "timeout");

      // clearLine
      const clearCall = writeSpy.mock.calls[0][0] as string;
      expect(clearCall).toBe("\r\x1b[K");

      // console.log with red X
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      expect(logOutput).toContain("✗");
      expect(logOutput).toContain("deploy");
      expect(logOutput).toContain("timeout");
    });

    it("fail() without error message omits suffix", () => {
      const reporter = createProgressReporter(2);
      reporter.fail("deploy");

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      expect(logOutput).toContain("✗");
      expect(logOutput).toContain("deploy");
      // Should not have trailing whitespace/error after stepId
      // The format is: `  ${pc.red("✗")} ${pc.blue(stepId)}` (no suffix)
      expect(logOutput).not.toContain("undefined");
    });

    it("done() clears the progress line", () => {
      const reporter = createProgressReporter(2);
      reporter.done();

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const clearCall = writeSpy.mock.calls[0][0] as string;
      expect(clearCall).toBe("\r\x1b[K");
    });

    it("start() updates the progress bar after completions", () => {
      const reporter = createProgressReporter(4);

      // Complete two steps first
      reporter.complete("a");
      reporter.complete("b");

      // Reset spies to isolate the start() call
      writeSpy.mockClear();
      consoleSpy.mockClear();

      reporter.start("c", "Testing");

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = writeSpy.mock.calls[0][0] as string;
      // Should show 50% since 2 of 4 completed
      expect(output).toContain("50%");
      expect(output).toContain("c: Testing");
    });
  });
});
