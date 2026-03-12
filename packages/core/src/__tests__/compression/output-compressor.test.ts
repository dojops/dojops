import { describe, it, expect } from "vitest";
import {
  compressOutput,
  compressCILog,
  compressScannerOutput,
  stripAnsi,
  deduplicateLines,
} from "../../compression/output-compressor";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("\x1B[31mERROR\x1B[0m")).toBe("ERROR");
  });

  it("removes cursor movement codes", () => {
    expect(stripAnsi("\x1B[2AERROR\x1B[K")).toBe("ERROR");
  });

  it("passes through plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1B]0;title\x07text")).toBe("text");
  });
});

describe("deduplicateLines", () => {
  it("collapses consecutive identical lines", () => {
    const lines = [
      "WARNING: deprecated",
      "WARNING: deprecated",
      "WARNING: deprecated",
      "ERROR: fail",
    ];
    const result = deduplicateLines(lines, 2);
    expect(result.lines).toEqual(["WARNING: deprecated (×3)", "ERROR: fail"]);
    expect(result.groups).toBe(1);
  });

  it("does not collapse below threshold", () => {
    const lines = ["a", "b", "b", "c"];
    const result = deduplicateLines(lines, 3);
    expect(result.lines).toEqual(["a", "b", "b", "c"]);
    expect(result.groups).toBe(0);
  });

  it("handles empty input", () => {
    const result = deduplicateLines([], 2);
    expect(result.lines).toEqual([]);
    expect(result.groups).toBe(0);
  });

  it("handles single line", () => {
    const result = deduplicateLines(["only"], 2);
    expect(result.lines).toEqual(["only"]);
    expect(result.groups).toBe(0);
  });

  it("collapses multiple groups", () => {
    const lines = ["a", "a", "b", "b", "b"];
    const result = deduplicateLines(lines, 2);
    expect(result.lines).toEqual(["a (×2)", "b (×3)"]);
    expect(result.groups).toBe(2);
  });
});

describe("compressOutput", () => {
  it("strips ANSI codes from output", () => {
    const result = compressOutput("\x1B[31mERROR: build failed\x1B[0m");
    expect(result.output).toContain("ERROR: build failed");
    expect(result.output).not.toContain("\x1B");
  });

  it("removes progress bar lines", () => {
    const input = [
      "Building project...",
      "|########          | 40%",
      "|################  | 80%",
      "|##################| 100%",
      "ERROR: compilation failed",
    ].join("\n");
    const result = compressOutput(input);
    expect(result.output).toContain("ERROR: compilation failed");
    expect(result.output).not.toContain("40%");
  });

  it("removes success/pass lines by default", () => {
    const input = [
      "Test suite: auth",
      "✓ login test passed",
      "✓ signup test passed",
      "✗ logout test FAILED",
      "ERROR: assertion failed",
    ].join("\n");
    const result = compressOutput(input);
    expect(result.output).toContain("FAILED");
    expect(result.output).toContain("ERROR: assertion failed");
    expect(result.output).not.toContain("passed");
  });

  it("keeps success lines when keepSuccess is true", () => {
    const input = "All tests passed\nERROR: lint failed";
    const result = compressOutput(input, { keepSuccess: true });
    expect(result.output).toContain("passed");
  });

  it("deduplicates repeated lines", () => {
    const lines = Array(50).fill("WARNING: deprecated API call").concat(["ERROR: build failed"]);
    const result = compressOutput(lines.join("\n"));
    expect(result.output).toContain("WARNING: deprecated API call (×50)");
    expect(result.output).toContain("ERROR: build failed");
    expect(result.duplicateGroups).toBe(1);
  });

  it("truncates to maxLines", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `ERROR line ${i}`);
    const result = compressOutput(lines.join("\n"), { maxLines: 100 });
    expect(result.compressedLines).toBeLessThanOrEqual(101); // 100 + truncation marker
    expect(result.output).toContain("truncated");
  });

  it("reports compression stats", () => {
    const input = [
      "\x1B[32m✓ test passed\x1B[0m",
      "WARNING: foo",
      "WARNING: foo",
      "WARNING: foo",
      "",
      "ERROR: build failed",
    ].join("\n");
    const result = compressOutput(input);
    expect(result.originalLines).toBe(6);
    expect(result.linesRemoved).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThan(1);
  });

  it("handles empty input", () => {
    const result = compressOutput("");
    expect(result.output).toBe("");
    expect(result.originalLines).toBe(1);
  });
});

describe("compressCILog", () => {
  it("compresses a typical CI log", () => {
    const ciLog = [
      "=== Starting CI pipeline ===",
      "Step 1/5: Installing dependencies...",
      "npm install",
      "added 1234 packages in 45s",
      "",
      "Step 2/5: Building...",
      "tsc --build",
      "src/index.ts(42,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/utils.ts(10,3): error TS2304: Cannot find name 'foo'.",
      "",
      "Build failed with 2 errors.",
      "=== Pipeline failed ===",
    ].join("\n");

    const result = compressCILog(ciLog);
    expect(result.output).toContain("error TS2322");
    expect(result.output).toContain("error TS2304");
    expect(result.compressedLines).toBeLessThan(result.originalLines);
  });
});

describe("compressScannerOutput", () => {
  it("compresses scanner output with findings", () => {
    const scanOutput = [
      "Running trivy scan...",
      "Pulling vulnerability database...",
      "2024-01-15T10:30:00.000Z",
      "",
      "CRITICAL: CVE-2024-0001 in lodash@4.17.20",
      "HIGH: CVE-2024-0002 in express@4.18.0",
      "No vulnerabilities found in 245 packages",
      "",
      "Scan completed successfully",
    ].join("\n");

    const result = compressScannerOutput(scanOutput);
    expect(result.output).toContain("CVE-2024-0001");
    expect(result.output).toContain("CVE-2024-0002");
    expect(result.compressedLines).toBeLessThan(result.originalLines);
  });
});
