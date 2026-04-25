import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDopsFile } from "../parser";
import { compilePromptV2 } from "../prompt-compiler";
import type { PromptContextV2 } from "../prompt-compiler";

const SKILLS_DIR = path.join(__dirname, "../../skills");

function compileSkillPrompt(filename: string, overrides?: Partial<PromptContextV2>): string {
  const skill = parseDopsFile(path.join(SKILLS_DIR, filename));
  return compilePromptV2(skill.sections, {
    contextBlock: skill.frontmatter.context,
    ...overrides,
  });
}

// ── Prompt compilation with real skills ──────────────────────────────

describe("terraform.dops compiled prompt", () => {
  it("includes outputGuidance content", () => {
    const prompt = compileSkillPrompt("terraform.dops");
    expect(prompt).toContain("HCL");
  });

  it("includes best practices as numbered list", () => {
    const prompt = compileSkillPrompt("terraform.dops");
    expect(prompt).toContain("1. ");
    expect(prompt).toContain("2. ");
  });

  it("substitutes all placeholders", () => {
    const prompt = compileSkillPrompt("terraform.dops");
    expect(prompt).not.toContain("{outputGuidance}");
    expect(prompt).not.toContain("{bestPractices}");
    expect(prompt).not.toContain("{context7Docs}");
    expect(prompt).not.toContain("{projectContext}");
  });

  it("includes reasoning steps for generation mode", () => {
    const prompt = compileSkillPrompt("terraform.dops");
    expect(prompt).toContain("reasoning steps");
    expect(prompt).toContain("Analyze");
    expect(prompt).toContain("Generate");
    expect(prompt).toContain("Verify");
  });

  it("switches to update mode when existingContent provided", () => {
    const prompt = compileSkillPrompt("terraform.dops", {
      existingContent: 'resource "aws_s3_bucket" "main" {}',
    });
    expect(prompt).toContain("UPDATING an existing configuration");
    expect(prompt).toContain("Preserve ALL existing content");
    expect(prompt).toContain("aws_s3_bucket");
    expect(prompt).toContain('<data label="existing-config">');
  });
});

describe("kubernetes.dops compiled prompt", () => {
  it("includes Kubernetes in outputGuidance", () => {
    const prompt = compileSkillPrompt("kubernetes.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("kubernetes");
  });

  it("includes best practices", () => {
    const prompt = compileSkillPrompt("kubernetes.dops");
    expect(prompt).toContain("1. ");
  });

  it("injects context7Docs when provided", () => {
    const prompt = compileSkillPrompt("kubernetes.dops", {
      context7Docs: "Use Deployment with rolling update strategy.",
    });
    expect(prompt).toContain("Use Deployment with rolling update strategy.");
    expect(prompt).toContain('<data label="reference-docs">');
  });

  it("injects projectContext when provided", () => {
    const prompt = compileSkillPrompt("kubernetes.dops", {
      projectContext: "Node.js 20 app with PostgreSQL",
    });
    expect(prompt).toContain("Node.js 20 app with PostgreSQL");
    expect(prompt).toContain('<data label="project-context">');
  });
});

describe("github-actions.dops compiled prompt", () => {
  it("includes GitHub Actions references", () => {
    const prompt = compileSkillPrompt("github-actions.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("github actions");
  });

  it("substitutes core variables without leftovers", () => {
    const prompt = compileSkillPrompt("github-actions.dops");
    expect(prompt).not.toContain("{outputGuidance}");
    expect(prompt).not.toContain("{bestPractices}");
    expect(prompt).not.toContain("{context7Docs}");
    expect(prompt).not.toContain("{projectContext}");
  });
});

describe("helm.dops compiled prompt", () => {
  it("mentions chart structure in outputGuidance", () => {
    const prompt = compileSkillPrompt("helm.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("chart");
  });

  it("includes best practices about Helm", () => {
    const prompt = compileSkillPrompt("helm.dops");
    expect(prompt).toContain("1. ");
  });
});

describe("dockerfile.dops compiled prompt", () => {
  it("includes Docker-specific guidance", () => {
    const prompt = compileSkillPrompt("dockerfile.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("docker");
  });

  it("references multi-stage or layering", () => {
    const prompt = compileSkillPrompt("dockerfile.dops");
    const lower = prompt.toLowerCase();
    expect(lower.includes("multi-stage") || lower.includes("layer")).toBe(true);
  });
});

describe("ansible.dops compiled prompt", () => {
  it("includes Ansible-specific content", () => {
    const prompt = compileSkillPrompt("ansible.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("ansible");
  });

  it("references roles or playbooks in guidance", () => {
    const prompt = compileSkillPrompt("ansible.dops");
    const lower = prompt.toLowerCase();
    expect(lower.includes("role") || lower.includes("playbook")).toBe(true);
  });
});

describe("prometheus.dops compiled prompt", () => {
  it("includes Prometheus-specific content", () => {
    const prompt = compileSkillPrompt("prometheus.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("prometheus");
  });
});

describe("istio.dops compiled prompt", () => {
  it("mentions ambient or waypoint", () => {
    const prompt = compileSkillPrompt("istio.dops");
    const lower = prompt.toLowerCase();
    expect(lower.includes("ambient") || lower.includes("waypoint")).toBe(true);
  });
});

describe("eks.dops compiled prompt", () => {
  it("mentions pod identity", () => {
    const prompt = compileSkillPrompt("eks.dops");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("podidentity");
  });
});

// ── Cross-cutting: all skills compile without errors ─────────────────

describe("all skills compile prompts cleanly", () => {
  const skillFiles: string[] = fs
    .readdirSync(SKILLS_DIR)
    .filter((f: string) => f.endsWith(".dops"));

  for (const file of skillFiles) {
    it(`${file} compiles without leftover placeholders`, () => {
      const prompt = compileSkillPrompt(file);
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).not.toContain("{outputGuidance}");
      expect(prompt).not.toContain("{bestPractices}");
    });
  }
});
