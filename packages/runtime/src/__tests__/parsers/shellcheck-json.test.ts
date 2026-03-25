import { describe, it, expect } from "vitest";
import { parseShellcheckJson } from "../../parsers/shellcheck-json";

describe("parseShellcheckJson", () => {
  it("parses ShellCheck JSON output correctly", () => {
    const output = JSON.stringify([
      {
        file: "deploy.sh",
        line: 10,
        column: 5,
        level: "warning",
        code: 2086,
        message: "Double quote to prevent globbing and word splitting.",
      },
      {
        file: "deploy.sh",
        line: 15,
        column: 1,
        level: "error",
        code: 2034,
        message: "foo appears unused. Verify use (or export).",
      },
    ]);

    const issues = parseShellcheckJson(output);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("SC2086");
    expect(issues[0].message).toContain("deploy.sh:10:5");
    expect(issues[1].severity).toBe("error");
    expect(issues[1].message).toContain("SC2034");
  });

  it("returns empty array for empty output", () => {
    expect(parseShellcheckJson("")).toEqual([]);
    expect(parseShellcheckJson("  ")).toEqual([]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseShellcheckJson("[]")).toEqual([]);
  });

  it("maps severity levels correctly", () => {
    const output = JSON.stringify([
      { file: "a.sh", line: 1, column: 1, level: "error", code: 1, message: "err" },
      { file: "a.sh", line: 2, column: 1, level: "warning", code: 2, message: "warn" },
      { file: "a.sh", line: 3, column: 1, level: "info", code: 3, message: "info" },
      { file: "a.sh", line: 4, column: 1, level: "style", code: 4, message: "style" },
    ]);

    const issues = parseShellcheckJson(output);
    expect(issues[0].severity).toBe("error");
    expect(issues[1].severity).toBe("warning");
    expect(issues[2].severity).toBe("info");
    expect(issues[3].severity).toBe("info"); // style maps to info
  });

  it("handles invalid JSON gracefully", () => {
    const issues = parseShellcheckJson("not valid json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("handles non-array JSON gracefully", () => {
    const issues = parseShellcheckJson('{"error": true}');
    expect(issues).toEqual([]);
  });
});
