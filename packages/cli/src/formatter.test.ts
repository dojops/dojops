import { describe, it, expect } from "vitest";
import {
  statusIcon,
  statusText,
  formatOutput,
  getOutputFileName,
  formatConfidence,
  riskColor,
  changeColor,
  maskToken,
} from "./formatter";

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
});

describe("formatOutput", () => {
  it("formats lines with indentation", () => {
    const result = formatOutput("line1\nline2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  it("truncates after 20 lines", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n");
    const result = formatOutput(lines);
    expect(result).toContain("5 more lines");
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
