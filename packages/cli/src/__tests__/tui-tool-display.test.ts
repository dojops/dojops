import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolDisplay } from "../tui/tool-display";

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

describe("ToolDisplay", () => {
  it("shows animated indicator on toolStart", () => {
    const display = new ToolDisplay();
    display.toolStart("read_file", "src/index.ts");

    expect(writeMock).toHaveBeenCalled();
    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("read_file");
    expect(output).toContain("src/index.ts");

    display.dispose();
  });

  it("shows checkmark on successful toolComplete", () => {
    const display = new ToolDisplay();
    display.toolStart("read_file", "src/index.ts");
    writeMock.mockClear();

    display.toolComplete("read_file", 23, false);

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("read_file");
    expect(output).toContain("23ms");

    display.dispose();
  });

  it("shows X on failed toolComplete", () => {
    const display = new ToolDisplay();
    display.toolStart("run_command", "npm test");
    writeMock.mockClear();

    display.toolComplete("run_command", 1200, true, "Exit code 1");

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✗");
    expect(output).toContain("run_command");
    expect(output).toContain("1.2s");
    expect(output).toContain("Exit code 1");

    display.dispose();
  });

  it("truncates long args", () => {
    const display = new ToolDisplay();
    const longArgs = "a".repeat(100);
    display.toolStart("read_file", longArgs);

    const output = writeMock.mock.calls.map((c) => c[0]).join("");
    // eslint-disable-next-line no-control-regex
    const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped.length).toBeLessThan(200); // should be truncated

    display.dispose();
  });

  it("dispose prevents further rendering", () => {
    const display = new ToolDisplay();
    display.dispose();
    writeMock.mockClear();

    display.toolStart("read_file", "test");
    expect(writeMock).not.toHaveBeenCalled();
  });
});
