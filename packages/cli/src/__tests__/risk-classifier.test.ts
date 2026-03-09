import { describe, it, expect } from "vitest";
import { classifyPlanRisk, classifyTaskRisk, classifyEffectiveRisk } from "../risk-classifier";
import { classifyPathRisk } from "@dojops/executor";
import type { RiskLevel } from "../risk-classifier";

/** Classify a single task and assert the expected risk level. */
function expectRisk(tool: string, description: string, expected: RiskLevel): void {
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
    ["kubernetes", "Set up RBAC for service accounts", "HIGH"],
  ] as const)("returns %s risk for %s (%s)", (tool, description, expected) => {
    expectRisk(tool, description, expected);
  });

  it.each([
    ["ansible", "Configure secret rotation", "CRITICAL"],
    ["terraform", "Rotate API credentials", "CRITICAL"],
    ["ansible", "Deploy password manager", "CRITICAL"],
  ] as const)("returns CRITICAL risk for %s (%s)", (tool, description, expected) => {
    expectRisk(tool, description, expected);
  });

  it("returns highest risk when mixed tasks", () => {
    const risk = classifyPlanRisk([
      { tool: "github-actions", description: "Create CI pipeline" },
      { tool: "terraform", description: "Create IAM role for deployment" },
    ]);
    expect(risk).toBe("HIGH");
  });

  it("returns CRITICAL when any task is CRITICAL", () => {
    const risk = classifyPlanRisk([
      { tool: "github-actions", description: "Create CI pipeline" },
      { tool: "ansible", description: "Rotate secret keys" },
    ]);
    expect(risk).toBe("CRITICAL");
  });

  it("returns LOW for empty task list", () => {
    expect(classifyPlanRisk([])).toBe("LOW");
  });
});

describe("classifyTaskRisk", () => {
  it("classifies individual task risk", () => {
    expect(classifyTaskRisk({ tool: "github-actions", description: "Create CI" })).toBe("LOW");
    expect(classifyTaskRisk({ tool: "dockerfile", description: "Create Dockerfile" })).toBe(
      "MEDIUM",
    );
    expect(classifyTaskRisk({ tool: "terraform", description: "Create IAM policy" })).toBe("HIGH");
    expect(classifyTaskRisk({ tool: "ansible", description: "Rotate secrets" })).toBe("CRITICAL");
  });
});

describe("classifyPathRisk", () => {
  it.each([
    [".ssh/id_rsa", "CRITICAL"],
    ["~/.ssh/authorized_keys", "CRITICAL"],
    [".gnupg/private-keys-v1.d/key", "CRITICAL"],
    ["/etc/shadow", "CRITICAL"],
    ["/etc/passwd", "CRITICAL"],
    ["/etc/sudoers", "CRITICAL"],
    ["server_private_key.pem", "CRITICAL"],
    ["certs/tls.pem", "CRITICAL"],
    ["id_rsa", "CRITICAL"],
    ["deploy_private-key.json", "CRITICAL"],
  ] as const)("returns CRITICAL for %s", (path, expected) => {
    expect(classifyPathRisk(path)).toBe(expected);
  });

  it.each([
    [".env", "HIGH"],
    [".env.production", "HIGH"],
    [".env.local", "HIGH"],
    ["config/credentials.yaml", "HIGH"],
    ["/etc/nginx/nginx.conf", "HIGH"],
    ["kubeconfig.yaml", "HIGH"],
    [".kube/config", "HIGH"],
    ["terraform.tfstate", "HIGH"],
    ["prod.tfvars", "HIGH"],
  ] as const)("returns HIGH for %s", (path, expected) => {
    expect(classifyPathRisk(path)).toBe(expected);
  });

  it.each([
    ["Dockerfile", "LOW"],
    ["main.tf", "LOW"],
    [".github/workflows/ci.yml", "LOW"],
    ["docker-compose.yml", "LOW"],
    ["Makefile", "LOW"],
    ["nginx.conf", "LOW"],
    ["src/index.ts", "LOW"],
  ] as const)("returns LOW for %s", (path, expected) => {
    expect(classifyPathRisk(path)).toBe(expected);
  });
});

describe("classifyEffectiveRisk", () => {
  it("returns task risk when no output paths", () => {
    expect(classifyEffectiveRisk({ tool: "terraform", description: "Create S3 bucket" })).toBe(
      "MEDIUM",
    );
    expect(classifyEffectiveRisk({ tool: "terraform", description: "Create S3 bucket" }, [])).toBe(
      "MEDIUM",
    );
  });

  it("elevates LOW task risk to HIGH when writing to .env", () => {
    const task = { tool: "github-actions", description: "Create CI pipeline" };
    expect(classifyTaskRisk(task)).toBe("LOW");
    expect(classifyEffectiveRisk(task, [".env"])).toBe("HIGH");
  });

  it("elevates LOW task risk to CRITICAL when writing to SSH keys", () => {
    const task = { tool: "makefile", description: "Create build config" };
    expect(classifyTaskRisk(task)).toBe("LOW");
    expect(classifyEffectiveRisk(task, [".ssh/id_rsa"])).toBe("CRITICAL");
  });

  it("keeps CRITICAL task risk even with LOW path risk", () => {
    const task = { tool: "ansible", description: "Rotate secrets" };
    expect(classifyTaskRisk(task)).toBe("CRITICAL");
    expect(classifyEffectiveRisk(task, ["Dockerfile"])).toBe("CRITICAL");
  });

  it("takes the max across multiple output paths", () => {
    const task = { tool: "github-actions", description: "Create CI pipeline" };
    expect(classifyEffectiveRisk(task, ["Dockerfile", ".env", "main.tf"])).toBe("HIGH");
  });

  it("takes the max when task is HIGH and path is CRITICAL", () => {
    const task = { tool: "terraform", description: "Create IAM policy" };
    expect(classifyTaskRisk(task)).toBe("HIGH");
    expect(classifyEffectiveRisk(task, [".ssh/id_rsa"])).toBe("CRITICAL");
  });
});
