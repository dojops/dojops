import { describe, it, expect } from "vitest";
import { classifyPlanRisk } from "./risk-classifier";

describe("classifyPlanRisk", () => {
  it("returns LOW for GitHub Actions CI job", () => {
    const risk = classifyPlanRisk([
      { tool: "github-actions", description: "Create CI pipeline for Node.js app" },
    ]);
    expect(risk).toBe("LOW");
  });

  it("returns LOW for Makefile generation", () => {
    const risk = classifyPlanRisk([
      { tool: "makefile", description: "Create Makefile for build automation" },
    ]);
    expect(risk).toBe("LOW");
  });

  it("returns LOW for Prometheus config", () => {
    const risk = classifyPlanRisk([{ tool: "prometheus", description: "Create alerting rules" }]);
    expect(risk).toBe("LOW");
  });

  it("returns MEDIUM for Dockerfile modification", () => {
    const risk = classifyPlanRisk([
      { tool: "dockerfile", description: "Create multi-stage Dockerfile" },
    ]);
    expect(risk).toBe("MEDIUM");
  });

  it("returns MEDIUM for Terraform without high-risk keywords", () => {
    const risk = classifyPlanRisk([{ tool: "terraform", description: "Create S3 bucket" }]);
    expect(risk).toBe("MEDIUM");
  });

  it("returns MEDIUM for Kubernetes deployment", () => {
    const risk = classifyPlanRisk([{ tool: "kubernetes", description: "Deploy application" }]);
    expect(risk).toBe("MEDIUM");
  });

  it("returns HIGH for IAM policy task", () => {
    const risk = classifyPlanRisk([
      { tool: "terraform", description: "Create IAM policy for S3 access" },
    ]);
    expect(risk).toBe("HIGH");
  });

  it("returns HIGH for security group modifications", () => {
    const risk = classifyPlanRisk([
      { tool: "terraform", description: "Update security group rules" },
    ]);
    expect(risk).toBe("HIGH");
  });

  it("returns HIGH for production deployment", () => {
    const risk = classifyPlanRisk([
      { tool: "kubernetes", description: "Deploy to production cluster" },
    ]);
    expect(risk).toBe("HIGH");
  });

  it("returns HIGH for secret management", () => {
    const risk = classifyPlanRisk([{ tool: "ansible", description: "Configure secret rotation" }]);
    expect(risk).toBe("HIGH");
  });

  it("returns HIGH for RBAC configuration", () => {
    const risk = classifyPlanRisk([
      { tool: "kubernetes", description: "Set up RBAC for service accounts" },
    ]);
    expect(risk).toBe("HIGH");
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
