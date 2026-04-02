import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMSpinner } from "../tui/spinner";

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

describe("LLMSpinner", () => {
  it("starts and renders a line", () => {
    const spinner = new LLMSpinner({ model: "gpt-4o" });
    spinner.start();

    expect(writeMock).toHaveBeenCalled();
    // Output contains the verb (some random verb)
    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("…"); // verb ends with ellipsis

    spinner.dispose();
  });

  it("setVerb changes the displayed verb", () => {
    const spinner = new LLMSpinner();
    spinner.setVerb("Routing");
    spinner.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Routing");

    spinner.dispose();
  });

  it("incrementTokens updates the token display", () => {
    const spinner = new LLMSpinner();
    spinner.start();
    writeMock.mockClear();

    spinner.incrementTokens(500);
    vi.advanceTimersByTime(100); // two frames

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("tokens");

    spinner.dispose();
  });

  it("stop clears the spinner line", () => {
    const spinner = new LLMSpinner();
    spinner.start();
    writeMock.mockClear();

    spinner.stop();

    // Stop should write cursor-show sequence
    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("\x1b[?25h");

    spinner.dispose();
  });

  it("dispose prevents further rendering", () => {
    const spinner = new LLMSpinner();
    spinner.start();
    spinner.dispose();
    writeMock.mockClear();

    vi.advanceTimersByTime(200);

    // No more writes after dispose
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("isActive reflects spinner state", () => {
    const spinner = new LLMSpinner();
    expect(spinner.isActive).toBe(false);

    spinner.start();
    expect(spinner.isActive).toBe(true);

    spinner.stop();
    expect(spinner.isActive).toBe(false);

    spinner.dispose();
  });

  it("setAgent includes agent name in output", () => {
    const spinner = new LLMSpinner();
    spinner.setAgent("terraform-expert");
    spinner.start();

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("terraform-expert");

    spinner.dispose();
  });
});
