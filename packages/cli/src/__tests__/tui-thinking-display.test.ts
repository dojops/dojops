import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThinkingDisplay } from "../tui/thinking-display";

const writeMock = vi.fn();
const originalWrite = process.stdout.write;
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  vi.useFakeTimers();
  process.stdout.write = writeMock as unknown as typeof process.stdout.write;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  delete process.env.CI;
  delete process.env.NO_COLOR;
  writeMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  process.stdout.write = originalWrite;
  Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
});

describe("ThinkingDisplay", () => {
  it("shows thinking indicator on start", () => {
    const display = new ThinkingDisplay();
    display.start();

    expect(writeMock).toHaveBeenCalled();
    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("∴");
    expect(output).toContain("Thinking");

    display.dispose();
  });

  it("stop prints duration", () => {
    const display = new ThinkingDisplay();
    display.start();
    vi.advanceTimersByTime(5000);
    writeMock.mockClear();

    const final = display.stop();

    expect(final).toContain("thought for");
    expect(final).toContain("5");

    display.dispose();
  });

  it("isActive reflects state", () => {
    const display = new ThinkingDisplay();
    expect(display.isActive()).toBe(false);

    display.start();
    expect(display.isActive()).toBe(true);

    display.stop();
    expect(display.isActive()).toBe(false);

    display.dispose();
  });

  it("update sets preview text", () => {
    const display = new ThinkingDisplay();
    display.start();
    display.update("Analyzing the authentication flow...");
    writeMock.mockClear();

    vi.advanceTimersByTime(50); // one frame

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Analyzing the authentication flow");

    display.dispose();
  });

  it("dispose prevents further rendering", () => {
    const display = new ThinkingDisplay();
    display.start();
    display.dispose();
    writeMock.mockClear();

    vi.advanceTimersByTime(200);
    expect(writeMock).not.toHaveBeenCalled();
  });
});
