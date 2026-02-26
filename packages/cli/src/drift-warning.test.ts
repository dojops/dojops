import { describe, it, expect } from "vitest";
import { getDriftWarnings } from "./drift-warning";

describe("getDriftWarnings", () => {
  it("returns warning for Terraform tasks", () => {
    const warnings = getDriftWarnings(["terraform"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tool).toBe("terraform");
    expect(warnings[0].message).toContain("terraform plan");
  });

  it("returns warning for Kubernetes tasks", () => {
    const warnings = getDriftWarnings(["kubernetes"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tool).toBe("kubernetes");
    expect(warnings[0].message).toContain("kubectl diff");
  });

  it("returns warning for Helm tasks", () => {
    const warnings = getDriftWarnings(["helm"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tool).toBe("helm");
    expect(warnings[0].message).toContain("helm diff");
  });

  it("returns warning for Ansible tasks", () => {
    const warnings = getDriftWarnings(["ansible"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].tool).toBe("ansible");
    expect(warnings[0].message).toContain("ansible --check");
  });

  it("returns no warnings for GitHub Actions tasks", () => {
    const warnings = getDriftWarnings(["github-actions"]);
    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings for GitLab CI tasks", () => {
    const warnings = getDriftWarnings(["gitlab-ci"]);
    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings for Makefile tasks", () => {
    const warnings = getDriftWarnings(["makefile"]);
    expect(warnings).toHaveLength(0);
  });

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
