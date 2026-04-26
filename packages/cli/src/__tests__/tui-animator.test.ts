import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Animator,
  cycleGlyph,
  shimmerLine,
  formatElapsed,
  formatTokenCount,
  formatDuration,
  isTTY,
} from "../tui/animator";

// Mock stdout
const writeMock = vi.fn();
const originalWrite = process.stdout.write;
const originalIsTTY = process.stdout.isTTY;
const originalColumns = process.stdout.columns;

beforeEach(() => {
  process.stdout.write = writeMock as unknown as typeof process.stdout.write;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });
  delete process.env.CI;
  delete process.env.NO_COLOR;
  writeMock.mockClear();
});

afterEach(() => {
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true });
});

describe("isTTY", () => {
  it("returns true when stdout is TTY and no CI/NO_COLOR", () => {
    expect(isTTY()).toBe(true);
  });

  it("returns false when CI is set", () => {
    process.env.CI = "true";
    expect(isTTY()).toBe(false);
  });

  it("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    expect(isTTY()).toBe(false);
  });

  it("returns false when stdout is not TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(isTTY()).toBe(false);
  });
});

describe("cycleGlyph", () => {
  it("cycles through glyphs based on frame", () => {
    expect(cycleGlyph(0)).toBe("·");
    expect(cycleGlyph(1)).toBe("✢");
    expect(cycleGlyph(5)).toBe("✽");
    expect(cycleGlyph(6)).toBe("·"); // wraps around
  });

  it("accepts custom glyph array", () => {
    expect(cycleGlyph(0, ["a", "b"])).toBe("a");
    expect(cycleGlyph(1, ["a", "b"])).toBe("b");
    expect(cycleGlyph(2, ["a", "b"])).toBe("a");
  });
});

describe("formatElapsed", () => {
  it("formats seconds", () => {
    const now = Date.now();
    const result = formatElapsed(now - 5000);
    expect(result).toBe("00:05");
  });

  it("formats minutes and seconds", () => {
    const now = Date.now();
    const result = formatElapsed(now - 65000);
    expect(result).toBe("01:05");
  });

  it("formats hours", () => {
    const now = Date.now();
    const result = formatElapsed(now - 3665000);
    expect(result).toBe("1:01:05");
  });
});

describe("formatTokenCount", () => {
  it("returns empty for zero", () => {
    expect(formatTokenCount(0)).toBe("");
  });

  it("formats small counts", () => {
    expect(formatTokenCount(500)).toBe("↓ 500 tokens");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokenCount(1500)).toBe("↓ 1.5K tokens");
  });

  it("drops trailing .0 in K format", () => {
    expect(formatTokenCount(2000)).toBe("↓ 2K tokens");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(50)).toBe("50ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1500)).toBe("1.5s");
  });

  it("formats minutes", () => {
    expect(formatDuration(65000)).toBe("1:05");
  });
});

describe("shimmerLine", () => {
  it("returns string of same visible length", () => {
    const result = shimmerLine("hello", 0);
    // Strip ANSI for length check
    // eslint-disable-next-line no-control-regex
    const stripped = result.replaceAll(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe("hello");
  });
});

describe("Animator", () => {
  it("calls renderFn and writes output on start", () => {
    vi.useFakeTimers();
    const animator = new Animator();
    const renderFn = vi.fn(() => ["line 1", "line 2"]);

    animator.start(renderFn);

    // First frame rendered immediately
    expect(renderFn).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalled();

    animator.dispose();
    vi.useRealTimers();
  });

  it("renders frames on interval", () => {
    vi.useFakeTimers();
    const animator = new Animator();
    const renderFn = vi.fn(() => ["line"]);

    animator.start(renderFn);
    expect(renderFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(renderFn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(50);
    expect(renderFn).toHaveBeenCalledTimes(3);

    animator.dispose();
    vi.useRealTimers();
  });

  it("increments frame counter", () => {
    vi.useFakeTimers();
    const animator = new Animator();
    const frames: number[] = [];

    animator.start(() => {
      frames.push(animator.currentFrame);
      return [""];
    });

    vi.advanceTimersByTime(100);

    expect(frames[0]).toBe(0);
    expect(frames[1]).toBe(1);
    expect(frames[2]).toBe(2);

    animator.dispose();
    vi.useRealTimers();
  });

  it("stop clears the timer and region", () => {
    vi.useFakeTimers();
    const animator = new Animator();

    animator.start(() => ["line"]);
    animator.stop();

    const callCountAfterStop = writeMock.mock.calls.length;
    vi.advanceTimersByTime(200);
    // No more writes after stop (timer cleared)
    expect(writeMock.mock.calls.length).toBe(callCountAfterStop);

    animator.dispose();
    vi.useRealTimers();
  });

  it("dispose prevents further starts", () => {
    vi.useFakeTimers();
    const animator = new Animator();
    animator.dispose();

    const renderFn = vi.fn(() => ["line"]);
    animator.start(renderFn);

    expect(renderFn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("isRunning reflects timer state", () => {
    vi.useFakeTimers();
    const animator = new Animator();

    expect(animator.isRunning).toBe(false);
    animator.start(() => ["line"]);
    expect(animator.isRunning).toBe(true);
    animator.stop();
    expect(animator.isRunning).toBe(false);

    animator.dispose();
    vi.useRealTimers();
  });
});
