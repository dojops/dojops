import { describe, it, expect } from "vitest";
import { resolveSkillDependencies } from "../dependency-resolver";

describe("resolveSkillDependencies", () => {
  const registry = {
    has: (name: string) => ["kubernetes", "helm", "docker-compose"].includes(name),
  };

  it("returns skill only when no dependencies", () => {
    const result = resolveSkillDependencies("terraform", [], registry);
    expect(result.order).toEqual(["terraform"]);
    expect(result.missing).toEqual([]);
  });

  it("resolves available dependencies in order", () => {
    const deps = [
      { skill: "kubernetes", optional: false },
      { skill: "helm", optional: false },
    ];
    const result = resolveSkillDependencies("istio", deps, registry);
    expect(result.order).toEqual(["kubernetes", "helm", "istio"]);
    expect(result.missing).toEqual([]);
  });

  it("reports missing required dependencies", () => {
    const deps = [{ skill: "nonexistent", optional: false }];
    const result = resolveSkillDependencies("terraform", deps, registry);
    expect(result.missing).toEqual(["nonexistent"]);
  });

  it("reports missing optional dependencies separately", () => {
    const deps = [{ skill: "nonexistent", optional: true }];
    const result = resolveSkillDependencies("terraform", deps, registry);
    expect(result.missingOptional).toEqual(["nonexistent"]);
    expect(result.missing).toEqual([]);
  });

  it("handles mix of available and missing dependencies", () => {
    const deps = [
      { skill: "kubernetes", optional: false },
      { skill: "nonexistent", optional: false },
      { skill: "another-missing", optional: true },
    ];
    const result = resolveSkillDependencies("istio", deps, registry);
    expect(result.order).toEqual(["kubernetes", "istio"]);
    expect(result.missing).toEqual(["nonexistent"]);
    expect(result.missingOptional).toEqual(["another-missing"]);
  });
});
