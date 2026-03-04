import { describe, it, expect } from "vitest";
import { parseActionlint } from "../../parsers/actionlint";

describe("parseActionlint", () => {
  it("parses single actionlint issue", () => {
    const output =
      'workflow.yml:10:3: property "push" is not defined in object type {branches: array<string>} [syntax-check]';
    const issues = parseActionlint(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].line).toBe(10);
    expect(issues[0].message).toContain("property");
  });

  it("parses multiple actionlint issues", () => {
    const output = [
      'workflow.yml:5:3: unexpected key "invalid_key" for "job" section. expected one of "name", "needs" [syntax-check]',
      'workflow.yml:12:7: label "latest" is unknown. available labels are "ubuntu-latest" [runner-label]',
      "workflow.yml:20:11: shellcheck reported issue in this script: SC2086 [shellcheck]",
    ].join("\n");
    const issues = parseActionlint(output);
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    expect(issues[0].line).toBe(5);
    expect(issues[1].line).toBe(12);
    expect(issues[2].line).toBe(20);
  });

  it("handles empty output", () => {
    const issues = parseActionlint("");
    expect(issues).toHaveLength(0);
  });

  it("handles whitespace-only output", () => {
    const issues = parseActionlint("  \n  \n  ");
    expect(issues).toHaveLength(0);
  });

  it("skips lines that do not match actionlint format", () => {
    const output = "Some random log line\nAnother random line";
    const issues = parseActionlint(output);
    expect(issues).toHaveLength(0);
  });

  it("truncates long messages", () => {
    const longMessage = "x".repeat(300);
    const output = `workflow.yml:1:1: ${longMessage} [test-rule]`;
    const issues = parseActionlint(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].message.length).toBeLessThanOrEqual(203); // 200 + "..."
  });
});
