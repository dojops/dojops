import { describe, it, expect } from "vitest";
import { parseHadolintJson } from "../../parsers/hadolint-json";

describe("parseHadolintJson", () => {
  it("parses hadolint output", () => {
    const output = JSON.stringify([
      { level: "warning", message: "Use COPY instead of ADD", line: 5, code: "DL3020" },
      { level: "error", message: "Missing FROM", line: 1, code: "DL3006" },
    ]);
    const issues = parseHadolintJson(output);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].line).toBe(5);
    expect(issues[0].rule).toBe("DL3020");
    expect(issues[1].severity).toBe("error");
  });

  it("handles empty array", () => {
    const issues = parseHadolintJson("[]");
    expect(issues).toHaveLength(0);
  });

  it("handles invalid JSON", () => {
    const issues = parseHadolintJson("not json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("maps info/style levels", () => {
    const output = JSON.stringify([
      { level: "info", message: "Info message", line: 1, code: "I001" },
      { level: "style", message: "Style message", line: 2, code: "S001" },
    ]);
    const issues = parseHadolintJson(output);
    expect(issues[0].severity).toBe("info");
    expect(issues[1].severity).toBe("info");
  });
});
