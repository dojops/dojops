import { describe, it, expect } from "vitest";
import { getDriftWarnings } from "../drift-warning";

describe("getDriftWarnings", () => {
  it.each([
    ["terraform", "terraform plan"],
    ["kubernetes", "kubectl diff"],
    ["helm", "helm diff"],
    ["ansible", "ansible --check"],
  ])("returns warning for %s tasks", (tool, expectedMsg) => {
    const warnings = getDriftWarnings([tool]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tool).toBe(tool);
    expect(warnings[0].message).toContain(expectedMsg);
  });

  it.each(["github-actions", "gitlab-ci", "makefile"])(
    "returns no warnings for %s tasks",
    (tool) => {
      expect(getDriftWarnings([tool])).toHaveLength(0);
    },
  );

  it("returns only relevant warnings for mixed tasks", () => {
    const warnings = getDriftWarnings(["github-actions", "terraform", "dockerfile", "kubernetes"]);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.tool)).toEqual(["terraform", "kubernetes"]);
  });

  it("deduplicates warnings for repeated tools", () => {
    const warnings = getDriftWarnings(["terraform", "terraform", "terraform"]);
    expect(warnings).toHaveLength(1);
  });

  it("returns empty array for no tools", () => {
    const warnings = getDriftWarnings([]);
    expect(warnings).toHaveLength(0);
  });
});
