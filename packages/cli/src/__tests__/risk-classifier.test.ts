import { describe, it, expect } from "vitest";
import { classifyPlanRisk } from "../risk-classifier";

/** Classify a single task and assert the expected risk level. */
function expectRisk(tool: string, description: string, expected: "LOW" | "MEDIUM" | "HIGH"): void {
  const risk = classifyPlanRisk([{ tool, description }]);
  expect(risk).toBe(expected);
}

describe("classifyPlanRisk", () => {
  it.each([
    ["github-actions", "Create CI pipeline for Node.js app", "LOW"],
    ["makefile", "Create Makefile for build automation", "LOW"],
    ["prometheus", "Create alerting rules", "LOW"],
    ["dockerfile", "Create multi-stage Dockerfile", "MEDIUM"],
    ["terraform", "Create S3 bucket", "MEDIUM"],
    ["kubernetes", "Deploy application", "MEDIUM"],
    ["terraform", "Create IAM policy for S3 access", "HIGH"],
    ["terraform", "Update security group rules", "HIGH"],
    ["kubernetes", "Deploy to production cluster", "HIGH"],
    ["ansible", "Configure secret rotation", "HIGH"],
    ["kubernetes", "Set up RBAC for service accounts", "HIGH"],
  ] as const)("returns %s risk for %s (%s)", (tool, description, expected) => {
    expectRisk(tool, description, expected);
  });

  it("returns highest risk when mixed tasks", () => {
    const risk = classifyPlanRisk([
      { tool: "github-actions", description: "Create CI pipeline" },
      { tool: "terraform", description: "Create IAM role for deployment" },
    ]);
    expect(risk).toBe("HIGH");
  });

  it("returns LOW for empty task list", () => {
    expect(classifyPlanRisk([])).toBe("LOW");
  });
});
