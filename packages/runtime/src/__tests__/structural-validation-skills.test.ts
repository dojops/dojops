import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { parseDopsFile } from "../parser";
import { validateStructure } from "../structural-validator";
import type { StructuralRule } from "../spec";

const SKILLS_DIR = path.join(__dirname, "../../skills");

function getRules(filename: string): StructuralRule[] {
  const skill = parseDopsFile(path.join(SKILLS_DIR, filename));
  return skill.frontmatter.verification?.structural ?? [];
}

// ── Kubernetes structural rules against realistic output ─────────────

describe("kubernetes.dops structural validation", () => {
  const rules = getRules("kubernetes.dops");

  it("has rules for kind and apiVersion", () => {
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules.some((r) => r.path === "kind")).toBe(true);
    expect(rules.some((r) => r.path === "apiVersion")).toBe(true);
  });

  it("passes valid Deployment manifest", () => {
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: "default" },
      spec: {
        replicas: 3,
        selector: { matchLabels: { app: "web" } },
        template: {
          metadata: { labels: { app: "web" } },
          spec: {
            containers: [{ name: "web", image: "nginx:1.25" }],
          },
        },
      },
    };
    const issues = validateStructure(deployment, rules);
    expect(issues).toHaveLength(0);
  });

  it("passes valid Service manifest", () => {
    const service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "web-svc" },
      spec: {
        selector: { app: "web" },
        ports: [{ port: 80, targetPort: 8080 }],
      },
    };
    const issues = validateStructure(service, rules);
    expect(issues).toHaveLength(0);
  });

  it("fails when kind is missing", () => {
    const badManifest = {
      apiVersion: "v1",
      metadata: { name: "broken" },
    };
    const issues = validateStructure(badManifest, rules);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.message.toLowerCase().includes("kind"))).toBe(true);
  });

  it("fails when apiVersion is missing", () => {
    const badManifest = {
      kind: "Deployment",
      metadata: { name: "broken" },
    };
    const issues = validateStructure(badManifest, rules);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.message.toLowerCase().includes("apiversion"))).toBe(true);
  });

  it("fails when both required fields are missing", () => {
    const empty = { metadata: { name: "empty" } };
    const issues = validateStructure(empty, rules);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Docker Compose structural rules ──────────────────────────────────

describe("docker-compose.dops structural validation", () => {
  const rules = getRules("docker-compose.dops");

  it("has rule for services key", () => {
    expect(rules.some((r) => r.path === "services")).toBe(true);
  });

  it("passes valid compose output", () => {
    const compose = {
      services: {
        web: {
          image: "nginx:1.25",
          ports: ["80:80"],
        },
        db: {
          image: "postgres:16",
          environment: { POSTGRES_PASSWORD: "secret" },
        },
      },
    };
    const issues = validateStructure(compose, rules);
    expect(issues).toHaveLength(0);
  });

  it("fails when services key is missing", () => {
    const badCompose = {
      version: "3.8",
      networks: { default: {} },
    };
    const issues = validateStructure(badCompose, rules);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GitLab CI structural rules ───────────────────────────────────────

describe("gitlab-ci.dops structural validation", () => {
  const rules = getRules("gitlab-ci.dops");

  it("has rule for stages key", () => {
    expect(rules.some((r) => r.path === "stages")).toBe(true);
  });

  it("passes valid GitLab CI output", () => {
    const gitlabCi = {
      stages: ["build", "test", "deploy"],
      build: {
        stage: "build",
        script: ["npm ci", "npm run build"],
      },
      test: {
        stage: "test",
        script: ["npm test"],
      },
    };
    const issues = validateStructure(gitlabCi, rules);
    expect(issues).toHaveLength(0);
  });

  it("fails when stages array is missing", () => {
    const badCi = {
      build: {
        script: ["npm ci"],
      },
    };
    const issues = validateStructure(badCi, rules);
    expect(issues.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Skills without structural rules ──────────────────────────────────

describe("skills without structural rules return empty issues", () => {
  const noStructuralSkills = [
    "terraform.dops",
    "vault.dops",
    "makefile.dops",
    "nginx.dops",
    "systemd.dops",
  ];

  for (const file of noStructuralSkills) {
    it(`${file} has no structural rules`, () => {
      const rules = getRules(file);
      expect(rules).toHaveLength(0);
    });
  }
});

// ── GitHub Actions uses binary verification, not structural ──────────

describe("github-actions.dops verification", () => {
  it("uses binary verification (actionlint), not structural rules", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "github-actions.dops"));
    expect(skill.frontmatter.verification?.structural).toBeUndefined();
    expect(skill.frontmatter.verification?.binary).toBeDefined();
    expect(skill.frontmatter.verification?.binary?.command).toContain("actionlint");
  });
});

// ── Wildcard rule validation with real patterns ──────────────────────

describe("structural validation wildcard paths", () => {
  it("validates array elements with * wildcard", () => {
    const rules: StructuralRule[] = [
      {
        path: "containers.*.image",
        required: true,
        message: "Each container must have an image",
      },
    ];
    const valid = {
      containers: [
        { name: "web", image: "nginx:1.25" },
        { name: "sidecar", image: "envoy:1.28" },
      ],
    };
    expect(validateStructure(valid, rules)).toHaveLength(0);

    const invalid = {
      containers: [{ name: "web", image: "nginx:1.25" }, { name: "sidecar" }],
    };
    expect(validateStructure(invalid, rules).length).toBeGreaterThanOrEqual(1);
  });

  it("validates nested wildcard paths", () => {
    const rules: StructuralRule[] = [
      {
        path: "jobs.*.steps",
        required: true,
        type: "array",
        message: "Each job must have steps array",
      },
    ];
    const valid = {
      jobs: {
        build: { steps: [{ run: "make" }] },
        test: { steps: [{ run: "make test" }] },
      },
    };
    expect(validateStructure(valid, rules)).toHaveLength(0);
  });

  it("validates requiredUnless with realistic data", () => {
    const rules: StructuralRule[] = [
      {
        path: "runs-on",
        required: true,
        requiredUnless: "uses",
        message: "runs-on required unless using reusable workflow",
      },
    ];

    const directJob = { "runs-on": "ubuntu-latest", steps: [] };
    expect(validateStructure(directJob, rules)).toHaveLength(0);

    const reusableJob = { uses: "org/workflow@v1", with: {} };
    expect(validateStructure(reusableJob, rules)).toHaveLength(0);

    const brokenJob = { steps: [{ run: "echo hello" }] };
    expect(validateStructure(brokenJob, rules).length).toBe(1);
  });
});
