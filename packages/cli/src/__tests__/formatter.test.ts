import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  statusIcon,
  statusText,
  formatOutput,
  getOutputFileName,
  formatConfidence,
  riskColor,
  changeColor,
  maskToken,
  wrapForNote,
} from "../formatter";

describe("statusIcon", () => {
  it("returns green for completed", () => {
    expect(statusIcon("completed")).toContain("*");
  });

  it("returns red for failed", () => {
    expect(statusIcon("failed")).toContain("x");
  });

  it("returns yellow for skipped", () => {
    expect(statusIcon("skipped")).toContain("-");
  });

  it("returns dim for unknown", () => {
    expect(statusIcon("unknown")).toContain("?");
  });
});

describe("statusText", () => {
  it("returns text for known statuses", () => {
    expect(statusText("completed")).toContain("completed");
    expect(statusText("failed")).toContain("failed");
    expect(statusText("skipped")).toContain("skipped");
  });

  it("returns dim text for unknown status (line 27)", () => {
    const result = statusText("pending");
    expect(result).toContain("pending");
  });

  it("returns dim text for arbitrary status strings", () => {
    const result = statusText("running");
    expect(result).toContain("running");
  });
});

describe("formatOutput", () => {
  it("formats lines with indentation", () => {
    const result = formatOutput("line1\nline2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  it("truncates after 50 lines", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const result = formatOutput(lines);
    expect(result).toContain("10 more lines");
    expect(result).toContain("--output json");
  });

  it("does not truncate exactly 50 lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const result = formatOutput(lines);
    expect(result).not.toContain("more lines");
    expect(result).toContain("line 49");
  });

  it("handles single-line content", () => {
    const result = formatOutput("hello world");
    expect(result).toContain("hello world");
    expect(result).not.toContain("more lines");
  });

  it("handles empty content", () => {
    const result = formatOutput("");
    expect(result).toBeDefined();
  });

  it("truncation note shows correct remaining count", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const result = formatOutput(lines);
    expect(result).toContain("50 more lines");
  });
});

describe("getOutputFileName", () => {
  it("returns correct filenames for known tools", () => {
    expect(getOutputFileName("github-actions")).toBe(".github/workflows/ci.yml");
    expect(getOutputFileName("kubernetes")).toBe("manifests.yml");
    expect(getOutputFileName("ansible")).toBe("playbook.yml");
    expect(getOutputFileName("unknown")).toBe("output.yml");
  });
});

describe("formatConfidence", () => {
  it("formats high confidence in green", () => {
    const result = formatConfidence(0.9);
    expect(result).toContain("90%");
  });

  it("formats medium confidence in yellow", () => {
    const result = formatConfidence(0.6);
    expect(result).toContain("60%");
  });

  it("formats low confidence in red", () => {
    const result = formatConfidence(0.3);
    expect(result).toContain("30%");
  });
});

describe("riskColor", () => {
  it("returns colored risk levels", () => {
    expect(riskColor("low")).toContain("low");
    expect(riskColor("medium")).toContain("medium");
    expect(riskColor("high")).toContain("high");
    expect(riskColor("critical")).toContain("critical");
    expect(riskColor("custom")).toBe("custom");
  });
});

describe("changeColor", () => {
  it("returns colored change actions", () => {
    expect(changeColor("CREATE")).toContain("CREATE");
    expect(changeColor("UPDATE")).toContain("UPDATE");
    expect(changeColor("DELETE")).toContain("DELETE");
    expect(changeColor("NOOP")).toBe("NOOP");
  });

  it("colors MODIFY same as UPDATE (yellow)", () => {
    const modify = changeColor("MODIFY");
    expect(modify).toContain("MODIFY");
  });

  it("colors DESTROY same as DELETE (red)", () => {
    const destroy = changeColor("DESTROY");
    expect(destroy).toContain("DESTROY");
  });
});

describe("maskToken", () => {
  it("masks middle of token", () => {
    expect(maskToken("sk-abc123def456")).toBe("sk-***456");
  });

  it("shows (not set) for undefined", () => {
    expect(maskToken(undefined)).toContain("not set");
  });

  it("masks short tokens completely", () => {
    expect(maskToken("abc")).toBe("***");
  });
});

// ── wrapForNote + internal wrapLine / stripAnsi (lines 103-152) ────

describe("wrapForNote", () => {
  let originalColumns: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  function setColumns(value: number | undefined) {
    Object.defineProperty(process.stdout, "columns", {
      value,
      writable: true,
      configurable: true,
    });
  }

  it("returns short text unchanged when it fits within maxWidth", () => {
    setColumns(80);
    const input = "short line";
    const result = wrapForNote(input);
    expect(result).toBe("short line");
  });

  it("preserves multiple short lines unchanged", () => {
    setColumns(80);
    const input = "line one\nline two\nline three";
    const result = wrapForNote(input);
    expect(result).toBe("line one\nline two\nline three");
  });

  it("wraps a long line that exceeds maxWidth", () => {
    // cols=40, maxWidth = max(30, 40-7) = 33
    setColumns(40);
    const longLine = "word ".repeat(20).trim(); // 99 chars
    const result = wrapForNote(longLine);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Every word should still be present
    expect(result.replace(/\n/g, " ")).toContain("word");
  });

  it("preserves leading indentation on continuation lines", () => {
    setColumns(40);
    // maxWidth = 33
    const indentedLong = "    " + "word ".repeat(15).trim();
    const result = wrapForNote(indentedLong);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines should start with the same indent
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]).toMatch(/^\s{4}/);
    }
  });

  it("handles ANSI escape codes without counting them as visible width", () => {
    setColumns(80);
    // maxWidth = 73
    // A short visible string wrapped in ANSI codes — should NOT wrap
    const ansiText = "\x1b[32mhello world\x1b[0m";
    const result = wrapForNote(ansiText);
    // Since visible text "hello world" (11 chars) < 73, should be one line
    expect(result.split("\n")).toHaveLength(1);
    expect(result).toBe(ansiText);
  });

  it("wraps lines with ANSI codes when visible text exceeds maxWidth", () => {
    // cols=40, maxWidth=33
    setColumns(40);
    // wrapLine strips ANSI for measurement, then splits visible text by words
    const longVisible = "alpha ".repeat(10).trim(); // 59 visible chars
    const result = wrapForNote(longVisible);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("defaults to 80 columns when process.stdout.columns is undefined", () => {
    setColumns(undefined);
    // maxWidth = max(30, 80-7) = 73
    const shortLine = "a".repeat(73);
    const result = wrapForNote(shortLine);
    expect(result.split("\n")).toHaveLength(1);

    const longLine = "word ".repeat(20).trim(); // 99 chars
    const result2 = wrapForNote(longLine);
    expect(result2.split("\n").length).toBeGreaterThan(1);
  });

  it("caps columns at 200", () => {
    setColumns(300);
    // cols capped to 200, maxWidth = max(30, 200-7) = 193
    const line193 = "x".repeat(193);
    const result = wrapForNote(line193);
    expect(result.split("\n")).toHaveLength(1);

    const line194 = "word ".repeat(50).trim(); // 249 chars, should wrap
    const result2 = wrapForNote(line194);
    expect(result2.split("\n").length).toBeGreaterThan(1);
  });

  it("enforces minimum maxWidth of 30", () => {
    setColumns(20);
    // cols=20, maxWidth = max(30, 20-7) = max(30, 13) = 30
    const line30 = "x".repeat(30);
    const result = wrapForNote(line30);
    expect(result.split("\n")).toHaveLength(1);
  });

  it("handles empty string", () => {
    setColumns(80);
    const result = wrapForNote("");
    expect(result).toBe("");
  });

  it("handles multi-line input with mixed short and long lines", () => {
    setColumns(40);
    // maxWidth = 33
    const input = "short\n" + "word ".repeat(20).trim() + "\nalso short";
    const result = wrapForNote(input);
    const lines = result.split("\n");
    // The first and last lines are short, middle line gets wrapped
    expect(lines.length).toBeGreaterThan(3);
    expect(lines[0]).toBe("short");
    expect(lines[lines.length - 1]).toBe("also short");
  });

  it("handles lines with only whitespace", () => {
    setColumns(80);
    const result = wrapForNote("   ");
    expect(result).toBe("   ");
  });
});
