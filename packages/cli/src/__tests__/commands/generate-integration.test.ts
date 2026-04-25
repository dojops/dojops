import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@dojops/skill-registry", () => ({
  createSkillRegistry: vi.fn(),
  discoverUserDopsFiles: vi.fn().mockReturnValue([]),
}));

import { isAnalysisIntent, autoDetectSkill, outputFormatted } from "../../commands/generate";

// ── isAnalysisIntent comprehensive tests ─────────────────────────────

describe("isAnalysisIntent — generation prompts", () => {
  it.each([
    "Create a GitHub Actions workflow for Node.js",
    "Generate terraform config for AWS S3",
    "Write a kubernetes deployment manifest",
    "Set up a dockerfile for Python",
    "Build a Makefile for the project",
    "Add an nginx reverse proxy",
    "Make a docker-compose file for PostgreSQL",
    "Configure prometheus alerting rules",
    "Deploy a helm chart for Redis",
    "Scaffold an Ansible playbook",
  ])("returns false for generation prompt: %s", (prompt) => {
    expect(isAnalysisIntent(prompt)).toBe(false);
  });
});

describe("isAnalysisIntent — analysis prompts", () => {
  it.each([
    "What do you think about our terraform modules?",
    "How should we structure our kubernetes manifests?",
    "Why is our CI pipeline slow?",
    "Is our dockerfile following best practices?",
    "Review the ansible playbook for issues",
    "Check our github actions for security holes",
    "Analyse the nginx configuration",
    "Evaluate our infrastructure as code setup",
    "What's wrong with this deployment?",
    "Can we improve our docker-compose?",
    "Tell me about the helm chart structure",
    "Are there any problems with our Makefile?",
  ])("returns true for analysis prompt: %s", (prompt) => {
    expect(isAnalysisIntent(prompt)).toBe(true);
  });
});

describe("isAnalysisIntent — edge cases", () => {
  it("returns true for trailing question mark", () => {
    expect(isAnalysisIntent("Our terraform config is fine?")).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isAnalysisIntent("")).toBe(false);
  });

  it("returns true for 'Describe our CI setup'", () => {
    expect(isAnalysisIntent("Describe our CI setup")).toBe(true);
  });

  it("returns false for imperative without analysis verbs", () => {
    expect(isAnalysisIntent("Terraform module for VPC")).toBe(false);
  });
});

// ── autoDetectSkill comprehensive tests ──────────────────────────────

describe("autoDetectSkill — all 38 skill keywords", () => {
  const skillPromptMap: [string, string][] = [
    ["jenkinsfile", "Create a Jenkinsfile for our Java app"],
    ["github-actions", "GitHub Actions workflow for CI"],
    ["gitlab-ci", "Set up GitLab CI pipeline"],
    ["terraform", "Terraform config for AWS VPC"],
    ["kubernetes", "K8s deployment for our API"],
    ["helm", "Helm chart for Redis"],
    ["ansible", "Ansible playbook for server setup"],
    ["docker-compose", "Docker compose file for dev environment"],
    ["dockerfile", "Dockerfile for Node.js app"],
    ["nginx", "Nginx reverse proxy config"],
    ["prometheus", "Prometheus alerting rules"],
    ["systemd", "Systemd service unit for our app"],
    ["makefile", "Makefile targets for build"],
    ["grafana", "Grafana dashboard for API metrics"],
    ["cloudformation", "CloudFormation template for EC2"],
    ["argocd", "ArgoCD application manifest"],
    ["pulumi", "Pulumi stack for our infra"],
    ["packer", "Packer template for AMI build"],
    ["otel-collector", "OpenTelemetry collector config"],
    ["azure-devops", "Azure DevOps pipeline for .NET"],
    ["aws-codepipeline", "AWS CodeBuild buildspec"],
    ["circleci", "CircleCI config for our monorepo"],
    ["bitbucket-pipelines", "Bitbucket Pipelines for deployment"],
    ["shell", "Write a bash script for backup"],
    ["python", "Python script for data migration"],
    ["powershell", "PowerShell script for AD management"],
  ];

  it.each(skillPromptMap)("detects %s from: %s", (expected, prompt) => {
    expect(autoDetectSkill(prompt)).toBe(expected);
  });
});

describe("autoDetectSkill — disambiguation", () => {
  it("detects docker-compose over dockerfile for compose prompts", () => {
    expect(autoDetectSkill("Create a docker-compose file")).toBe("docker-compose");
  });

  it("detects powershell before shell for PowerShell prompts", () => {
    expect(autoDetectSkill("Write a powershell script for IIS")).toBe("powershell");
  });

  it("detects python for boto3 prompts", () => {
    expect(autoDetectSkill("Write a boto3 script for S3")).toBe("python");
  });

  it("detects shell for generic script prompts", () => {
    expect(autoDetectSkill("Create a deploy script for production")).toBe("shell");
  });
});

// ── outputFormatted tests ────────────────────────────────────────────

describe("outputFormatted — JSON output", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("renders multi-file JSON content as nested object", () => {
    const multiFile = JSON.stringify({
      files: {
        Dockerfile: 'FROM node:20-slim\nCOPY . .\nCMD ["node", "index.js"]',
        ".dockerignore": "node_modules\n.git",
      },
    });
    outputFormatted("json", "skill", "dockerfile", multiFile);

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.skill).toBe("dockerfile");
    expect(output.content.files.Dockerfile).toContain("FROM node:20-slim");
    expect(output.content.files[".dockerignore"]).toContain("node_modules");
  });

  it("handles deeply nested JSON structures", () => {
    const nested = JSON.stringify({
      resources: { aws_s3_bucket: { name: "my-bucket" } },
    });
    outputFormatted("json", "skill", "terraform", nested);

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.content.resources.aws_s3_bucket.name).toBe("my-bucket");
  });

  it("agent key used for agent-routed output", () => {
    outputFormatted("json", "agent", "ops-cortex", "Analysis: looks good");

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.agent).toBe("ops-cortex");
    expect(output.content).toBe("Analysis: looks good");
  });
});

describe("outputFormatted — YAML output", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("indents multi-line content correctly", () => {
    outputFormatted("yaml", "skill", "makefile", ".PHONY: all\nall:\n\t@echo done");

    expect(consoleSpy.mock.calls[0][0]).toBe("---");
    expect(consoleSpy.mock.calls[1][0]).toBe("skill: makefile");
    expect(consoleSpy.mock.calls[2][0]).toBe("content: |");
    expect(consoleSpy.mock.calls[3][0]).toBe("  .PHONY: all");
    expect(consoleSpy.mock.calls[4][0]).toBe("  all:");
    expect(consoleSpy.mock.calls[5][0]).toBe("  \t@echo done");
  });

  it("handles empty content", () => {
    outputFormatted("yaml", "skill", "nginx", "");

    expect(consoleSpy.mock.calls[0][0]).toBe("---");
    expect(consoleSpy.mock.calls[2][0]).toBe("content: |");
    expect(consoleSpy.mock.calls[3][0]).toBe("  ");
  });
});
