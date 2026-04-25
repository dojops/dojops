import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

vi.mock("@dojops/skill-registry", () => ({
  createSkillRegistry: vi.fn(),
  discoverUserDopsFiles: vi.fn().mockReturnValue([]),
}));

import { isAnalysisIntent, autoDetectSkill, outputFormatted } from "../../commands/generate";
import { parseGenericFiles, writeGenericFiles } from "../../commands/apply";
import { createFixtureProvider, makeTestCtx } from "../fixture-provider";

// ── Generate pipeline: routing decision chain ──────────────────────

describe("Generate pipeline — routing decision chain", () => {
  it("analysis prompts bypass skill detection", () => {
    const analysisPrompts = [
      "Why is our CI pipeline slow?",
      "What's wrong with the terraform config?",
      "Review our kubernetes manifests",
      "How should we improve our Dockerfile?",
    ];
    for (const prompt of analysisPrompts) {
      expect(isAnalysisIntent(prompt)).toBe(true);
      expect(autoDetectSkill(prompt)).toBeUndefined();
    }
  });

  it("generation prompts route to correct skills", () => {
    const routes: [string, string][] = [
      ["Create a Dockerfile for Node.js", "dockerfile"],
      ["Generate terraform config for AWS VPC", "terraform"],
      ["Set up GitHub Actions CI", "github-actions"],
      ["Write a kubernetes deployment", "kubernetes"],
      ["Create a Helm chart", "helm"],
      ["Build a Makefile for the project", "makefile"],
      ["Write an ansible playbook", "ansible"],
      ["Create nginx config", "nginx"],
      ["Generate a docker-compose file", "docker-compose"],
    ];
    for (const [prompt, expectedSkill] of routes) {
      expect(isAnalysisIntent(prompt)).toBe(false);
      expect(autoDetectSkill(prompt)).toBe(expectedSkill);
    }
  });

  it("unrecognized prompts fall through to agent routing", () => {
    const unmatched = [
      "Deploy my app to production",
      "Set up monitoring for the cluster",
      "Optimize the database queries",
    ];
    for (const prompt of unmatched) {
      expect(autoDetectSkill(prompt)).toBeUndefined();
    }
  });
});

// ── Generate pipeline: output formatting ───────────────────────────

describe("Generate pipeline — output formatting pipeline", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("JSON output embeds structured content as object", () => {
    const content = JSON.stringify({ files: { "main.tf": 'resource "aws_vpc" {}' } });
    outputFormatted("json", "agent", "terraform-specialist", content);

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.agent).toBe("terraform-specialist");
    expect(typeof output.content).toBe("object");
    expect(output.content.files["main.tf"]).toContain("aws_vpc");
  });

  it("JSON output keeps plain text as string", () => {
    outputFormatted("json", "skill", "dockerfile", "FROM node:20-slim\nRUN npm ci");

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(typeof output.content).toBe("string");
    expect(output.content).toContain("FROM node:20-slim");
  });

  it("YAML output produces valid block scalar", () => {
    outputFormatted("yaml", "skill", "nginx", "server {\n  listen 80;\n}");

    expect(consoleSpy.mock.calls[0][0]).toBe("---");
    expect(consoleSpy.mock.calls[1][0]).toBe("skill: nginx");
    expect(consoleSpy.mock.calls[2][0]).toBe("content: |");
  });

  it("handles broken JSON gracefully in JSON mode", () => {
    outputFormatted("json", "agent", "ops-cortex", "{invalid json here");

    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(typeof output.content).toBe("string");
    expect(output.content).toBe("{invalid json here");
  });
});

// ── Apply pipeline: file extraction ────────────────────────────────

describe("Apply pipeline — file extraction and writing", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-apply-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses multi-file JSON output from LLM", () => {
    const raw = JSON.stringify({
      files: {
        Dockerfile: "FROM node:20\nRUN npm ci",
        ".github/workflows/ci.yml": "name: CI\non: push\njobs: {}",
        Makefile: "all:\n\techo build",
      },
    });
    const result = parseGenericFiles(raw);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toHaveLength(3);
    expect(result!["Dockerfile"]).toContain("FROM node:20");
    expect(result![".github/workflows/ci.yml"]).toContain("CI");
  });

  it("rejects non-JSON LLM output", () => {
    expect(parseGenericFiles("Just a plain text Dockerfile")).toBeNull();
  });

  it("rejects JSON without files field", () => {
    expect(parseGenericFiles('{"content": "hello"}')).toBeNull();
  });

  it("rejects empty files map", () => {
    expect(parseGenericFiles('{"files": {}}')).toBeNull();
  });

  it("filters non-string values from files map", () => {
    const raw = JSON.stringify({
      files: {
        "valid.txt": "content",
        invalid: 42,
        "also-bad": null,
      },
    });
    const result = parseGenericFiles(raw);
    expect(result).toEqual({ "valid.txt": "content" });
  });

  it("writeGenericFiles writes files to disk", () => {
    const files: Record<string, string> = {
      "hello.txt": "Hello, world!",
      "sub/nested.txt": "Nested content",
    };
    writeGenericFiles(files, tmpDir);

    expect(fs.readFileSync(path.join(tmpDir, "hello.txt"), "utf-8")).toBe("Hello, world!");
    expect(fs.readFileSync(path.join(tmpDir, "sub", "nested.txt"), "utf-8")).toBe("Nested content");
  });

  it("writeGenericFiles creates nested directories", () => {
    writeGenericFiles(
      {
        "a/b/c/deep.yml": "key: value",
      },
      tmpDir,
    );
    expect(fs.existsSync(path.join(tmpDir, "a", "b", "c", "deep.yml"))).toBe(true);
  });
});

// ── Fixture provider: rule matching ────────────────────────────────

describe("Fixture provider — rule-based mock", () => {
  it("matches on system prompt substring", async () => {
    const provider = createFixtureProvider([
      {
        systemContains: "terraform",
        response: { content: 'resource "aws_vpc" "main" {}' },
      },
    ]);

    const res = await provider.generate({
      prompt: "Create VPC",
      system: "You are a terraform specialist",
    });
    expect(res.content).toContain("aws_vpc");
  });

  it("matches on user prompt substring", async () => {
    const provider = createFixtureProvider([
      {
        promptContains: "Dockerfile",
        response: { content: "FROM node:20-slim" },
      },
    ]);

    const res = await provider.generate({ prompt: "Create a Dockerfile" });
    expect(res.content).toBe("FROM node:20-slim");
  });

  it("falls back to generic response when no rule matches", async () => {
    const provider = createFixtureProvider([
      {
        promptContains: "terraform",
        response: { content: "terraform output" },
      },
    ]);

    const res = await provider.generate({ prompt: "Unrelated question" });
    expect(res.content).toBe("Mock response");
  });

  it("records all LLM calls for inspection", async () => {
    const provider = createFixtureProvider([]);
    await provider.generate({ prompt: "q1" });
    await provider.generate({ prompt: "q2", system: "sys" });

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].prompt).toBe("q1");
    expect(provider.calls[1].system).toBe("sys");
  });

  it("first matching rule wins", async () => {
    const provider = createFixtureProvider([
      { promptContains: "create", response: { content: "rule-1" } },
      { promptContains: "create", response: { content: "rule-2" } },
    ]);

    const res = await provider.generate({ prompt: "create something" });
    expect(res.content).toBe("rule-1");
  });
});

// ── CLI context construction ───────────────────────────────────────

describe("CLI context construction", () => {
  it("makeTestCtx builds a valid context with defaults", () => {
    const provider = createFixtureProvider([]);
    const ctx = makeTestCtx(provider);

    expect(ctx.globalOpts.output).toBe("table");
    expect(ctx.globalOpts.nonInteractive).toBe(true);
    expect(ctx.globalOpts.raw).toBe(false);
    expect(ctx.getProvider()).toBe(provider);
    expect(ctx.cwd).toBe("/tmp/test-project");
  });

  it("makeTestCtx accepts global option overrides", () => {
    const provider = createFixtureProvider([]);
    const ctx = makeTestCtx(provider, { output: "json", verbose: true, quiet: true });

    expect(ctx.globalOpts.output).toBe("json");
    expect(ctx.globalOpts.verbose).toBe(true);
    expect(ctx.globalOpts.quiet).toBe(true);
    expect(ctx.globalOpts.nonInteractive).toBe(true);
  });
});

// ── Skill detection: all 38 built-in skills ────────────────────────

describe("Skill detection — coverage of major skill keywords", () => {
  const skillTests: [string, string][] = [
    ["jenkinsfile", "Create a Jenkinsfile for CI"],
    ["github-actions", "GitHub Actions workflow for build"],
    ["gitlab-ci", "Set up GitLab CI pipeline"],
    ["terraform", "Terraform config for AWS"],
    ["kubernetes", "K8s deployment manifest"],
    ["helm", "Create a Helm chart"],
    ["ansible", "Ansible playbook for setup"],
    ["dockerfile", "Dockerfile for Python app"],
    ["docker-compose", "Docker Compose for PostgreSQL"],
    ["nginx", "Nginx reverse proxy config"],
    ["makefile", "Create a Makefile"],
    ["shell", "Write a bash script"],
    ["python", "Create a Python script"],
  ];

  it.each(skillTests)("detects '%s' from prompt", (expected, prompt) => {
    expect(autoDetectSkill(prompt)).toBe(expected);
  });

  it("case-insensitive skill detection", () => {
    expect(autoDetectSkill("create a DOCKERFILE")).toBe("dockerfile");
    expect(autoDetectSkill("TERRAFORM config")).toBe("terraform");
    expect(autoDetectSkill("KUBERNETES deployment")).toBe("kubernetes");
  });
});
