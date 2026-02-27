import { describe, it, expect } from "vitest";
import { parseTerraformJson } from "../../parsers/terraform-json";

describe("parseTerraformJson", () => {
  it("parses valid output with no diagnostics", () => {
    const output = JSON.stringify({ valid: true, diagnostics: [] });
    const issues = parseTerraformJson(output);
    expect(issues).toHaveLength(0);
  });

  it("parses error diagnostics", () => {
    const output = JSON.stringify({
      valid: false,
      diagnostics: [
        { severity: "error", summary: "Missing provider", detail: "No provider configured" },
      ],
    });
    const issues = parseTerraformJson(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Missing provider");
    expect(issues[0].message).toContain("No provider configured");
  });

  it("parses warning diagnostics", () => {
    const output = JSON.stringify({
      valid: true,
      diagnostics: [{ severity: "warning", summary: "Deprecated feature" }],
    });
    const issues = parseTerraformJson(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("handles invalid JSON", () => {
    const issues = parseTerraformJson("not json");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("Failed to parse");
  });

  it("handles missing diagnostics field", () => {
    const output = JSON.stringify({ valid: true });
    const issues = parseTerraformJson(output);
    expect(issues).toHaveLength(0);
  });
});
