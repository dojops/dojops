import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  detectLanguages,
  detectPackageManager,
  detectCI,
  detectContainer,
  detectInfra,
  detectMonitoring,
  detectMetadata,
  deriveRelevantDomains,
  scanRepo,
  generateDirectoryTree,
  enrichWithLLM,
} from "./scanner";
import { RepoContextSchema, LLMInsightsSchema } from "./types";
import type { LLMProvider } from "../llm/provider";

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oda-scanner-"));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── detectLanguages ─────────────────────────────────────────────────

describe("detectLanguages", () => {
  it("detects Node.js from package.json", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const result = detectLanguages(dir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("node");
    expect(result[0].indicator).toBe("package.json");
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it("detects Python from requirements.txt", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "requirements.txt"), "");
    const result = detectLanguages(dir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("python");
  });

  it("detects Python from pyproject.toml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pyproject.toml"), "");
    const result = detectLanguages(dir);
    expect(result[0].name).toBe("python");
    expect(result[0].indicator).toBe("pyproject.toml");
  });

  it("detects Go from go.mod", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "go.mod"), "");
    const result = detectLanguages(dir);
    expect(result[0].name).toBe("go");
  });

  it("detects Rust from Cargo.toml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Cargo.toml"), "");
    const result = detectLanguages(dir);
    expect(result[0].name).toBe("rust");
  });

  it("detects Java from pom.xml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pom.xml"), "");
    const result = detectLanguages(dir);
    expect(result[0].name).toBe("java");
  });

  it("detects Ruby from Gemfile", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Gemfile"), "");
    const result = detectLanguages(dir);
    expect(result[0].name).toBe("ruby");
  });

  it("detects multiple languages", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "go.mod"), "");
    const result = detectLanguages(dir);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name);
    expect(names).toContain("node");
    expect(names).toContain("go");
  });

  it("returns empty for empty directory", () => {
    const dir = makeTmpDir();
    expect(detectLanguages(dir)).toEqual([]);
  });

  it("detects languages in child directories", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "backend"));
    fs.writeFileSync(path.join(dir, "backend", "package.json"), "{}");
    fs.mkdirSync(path.join(dir, "frontend"));
    fs.writeFileSync(path.join(dir, "frontend", "package.json"), "{}");
    const result = detectLanguages(dir);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((r) => r.indicator === "backend/package.json")).toBe(true);
    expect(result.some((r) => r.indicator === "frontend/package.json")).toBe(true);
  });

  it("detects different languages across child dirs", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "api"));
    fs.writeFileSync(path.join(dir, "api", "go.mod"), "");
    fs.mkdirSync(path.join(dir, "web"));
    fs.writeFileSync(path.join(dir, "web", "package.json"), "{}");
    const result = detectLanguages(dir);
    const names = result.map((r) => r.name);
    expect(names).toContain("go");
    expect(names).toContain("node");
  });

  it("gives child dir detections lower confidence than root", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "app"));
    fs.writeFileSync(path.join(dir, "app", "package.json"), "{}");
    const result = detectLanguages(dir);
    expect(result[0].confidence).toBeLessThan(0.9);
  });

  it("skips dotfiles and node_modules dirs", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".hidden"));
    fs.writeFileSync(path.join(dir, ".hidden", "package.json"), "{}");
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "package.json"), "{}");
    expect(detectLanguages(dir)).toEqual([]);
  });
});

// ── detectPackageManager ────────────────────────────────────────────

describe("detectPackageManager", () => {
  it("detects pnpm", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    const result = detectPackageManager(dir);
    expect(result).toEqual({ name: "pnpm", lockfile: "pnpm-lock.yaml" });
  });

  it("detects yarn", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "yarn.lock"), "");
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("yarn");
  });

  it("detects npm", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("npm");
  });

  it("returns null for unknown", () => {
    const dir = makeTmpDir();
    expect(detectPackageManager(dir)).toBeNull();
  });

  it("detects lockfile in child directory when root has none", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "backend"));
    fs.writeFileSync(path.join(dir, "backend", "package-lock.json"), "{}");
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("npm");
    expect(result?.lockfile).toBe("backend/package-lock.json");
  });

  it("prefers root lockfile over child dir", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    fs.mkdirSync(path.join(dir, "app"));
    fs.writeFileSync(path.join(dir, "app", "yarn.lock"), "");
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("pnpm");
    expect(result?.lockfile).toBe("pnpm-lock.yaml");
  });
});

// ── detectCI ─────────────────────────────────────────────────────────

describe("detectCI", () => {
  it("detects GitHub Actions workflows", () => {
    const dir = makeTmpDir();
    const wfDir = path.join(dir, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "ci.yml"), "");
    fs.writeFileSync(path.join(wfDir, "release.yaml"), "");
    const result = detectCI(dir);
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe("github-actions");
    expect(result[0].configPath).toBe(".github/workflows/ci.yml");
  });

  it("detects GitLab CI", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, ".gitlab-ci.yml"), "");
    const result = detectCI(dir);
    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe("gitlab-ci");
  });

  it("detects Jenkins", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Jenkinsfile"), "");
    const result = detectCI(dir);
    expect(result[0].platform).toBe("jenkins");
  });

  it("detects CircleCI", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".circleci"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".circleci", "config.yml"), "");
    const result = detectCI(dir);
    expect(result[0].platform).toBe("circleci");
  });

  it("returns empty for no CI", () => {
    const dir = makeTmpDir();
    expect(detectCI(dir)).toEqual([]);
  });
});

// ── detectContainer ──────────────────────────────────────────────────

describe("detectContainer", () => {
  it("detects Dockerfile", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Dockerfile"), "");
    const result = detectContainer(dir);
    expect(result.hasDockerfile).toBe(true);
    expect(result.hasCompose).toBe(false);
  });

  it("detects docker-compose.yml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), "");
    const result = detectContainer(dir);
    expect(result.hasCompose).toBe(true);
    expect(result.composePath).toBe("docker-compose.yml");
  });

  it("detects compose.yaml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "compose.yaml"), "");
    const result = detectContainer(dir);
    expect(result.hasCompose).toBe(true);
    expect(result.composePath).toBe("compose.yaml");
  });

  it("returns false for no containers", () => {
    const dir = makeTmpDir();
    const result = detectContainer(dir);
    expect(result.hasDockerfile).toBe(false);
    expect(result.hasCompose).toBe(false);
    expect(result.composePath).toBeUndefined();
  });

  it("detects Dockerfile in child directory", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "backend"));
    fs.writeFileSync(path.join(dir, "backend", "Dockerfile"), "FROM node:20");
    const result = detectContainer(dir);
    expect(result.hasDockerfile).toBe(true);
  });
});

// ── detectInfra ──────────────────────────────────────────────────────

describe("detectInfra", () => {
  it("detects Terraform files", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), 'provider "aws" {}');
    const result = detectInfra(dir);
    expect(result.hasTerraform).toBe(true);
    expect(result.tfProviders).toContain("aws");
  });

  it("detects multiple Terraform providers", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), 'provider "aws" {}\nprovider "google" {}');
    const result = detectInfra(dir);
    expect(result.tfProviders).toContain("aws");
    expect(result.tfProviders).toContain("gcp");
  });

  it("detects terraform state", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), "");
    fs.writeFileSync(path.join(dir, "terraform.tfstate"), "{}");
    const result = detectInfra(dir);
    expect(result.hasState).toBe(true);
  });

  it("detects Kubernetes from k8s directory", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "k8s"));
    const result = detectInfra(dir);
    expect(result.hasKubernetes).toBe(true);
  });

  it("detects Kubernetes from kubernetes directory", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "kubernetes"));
    const result = detectInfra(dir);
    expect(result.hasKubernetes).toBe(true);
  });

  it("does NOT detect Kubernetes from deploy/ without k8s content", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "deploy"));
    fs.writeFileSync(path.join(dir, "deploy", "notes.txt"), "just some notes");
    const result = detectInfra(dir);
    expect(result.hasKubernetes).toBe(false);
  });

  it("detects Kubernetes from deploy/ with k8s manifests", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "deploy"));
    fs.writeFileSync(
      path.join(dir, "deploy", "service.yaml"),
      "apiVersion: v1\nkind: Service\nmetadata:\n  name: myapp",
    );
    const result = detectInfra(dir);
    expect(result.hasKubernetes).toBe(true);
  });

  it("does NOT detect Kubernetes from manifests/ without k8s content", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "manifests"));
    fs.writeFileSync(path.join(dir, "manifests", "data.yaml"), "key: value");
    const result = detectInfra(dir);
    expect(result.hasKubernetes).toBe(false);
  });

  it("detects Helm", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Chart.yaml"), "");
    const result = detectInfra(dir);
    expect(result.hasHelm).toBe(true);
  });

  it("detects Ansible", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "playbook.yml"), "");
    const result = detectInfra(dir);
    expect(result.hasAnsible).toBe(true);
  });

  it("returns defaults for empty directory", () => {
    const dir = makeTmpDir();
    const result = detectInfra(dir);
    expect(result.hasTerraform).toBe(false);
    expect(result.tfProviders).toEqual([]);
    expect(result.hasState).toBe(false);
    expect(result.hasKubernetes).toBe(false);
    expect(result.hasHelm).toBe(false);
    expect(result.hasAnsible).toBe(false);
  });
});

// ── detectMonitoring ─────────────────────────────────────────────────

describe("detectMonitoring", () => {
  it("detects prometheus.yml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "prometheus.yml"), "");
    expect(detectMonitoring(dir).hasPrometheus).toBe(true);
  });

  it("detects nginx.conf", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "nginx.conf"), "");
    expect(detectMonitoring(dir).hasNginx).toBe(true);
  });

  it("detects .service files", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "myapp.service"), "");
    expect(detectMonitoring(dir).hasSystemd).toBe(true);
  });

  it("returns all false for empty", () => {
    const dir = makeTmpDir();
    const result = detectMonitoring(dir);
    expect(result.hasPrometheus).toBe(false);
    expect(result.hasNginx).toBe(false);
    expect(result.hasSystemd).toBe(false);
  });
});

// ── detectMetadata ───────────────────────────────────────────────────

describe("detectMetadata", () => {
  it("detects git repo", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".git"));
    expect(detectMetadata(dir).isGitRepo).toBe(true);
  });

  it("detects monorepo from pnpm-workspace.yaml", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "");
    expect(detectMetadata(dir).isMonorepo).toBe(true);
  });

  it("detects multi-app repo as monorepo", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "backend"));
    fs.writeFileSync(path.join(dir, "backend", "package.json"), "{}");
    fs.mkdirSync(path.join(dir, "frontend"));
    fs.writeFileSync(path.join(dir, "frontend", "package.json"), "{}");
    expect(detectMetadata(dir).isMonorepo).toBe(true);
  });

  it("does not flag single child app as monorepo", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "app"));
    fs.writeFileSync(path.join(dir, "app", "package.json"), "{}");
    expect(detectMetadata(dir).isMonorepo).toBe(false);
  });

  it("detects Makefile", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Makefile"), "");
    expect(detectMetadata(dir).hasMakefile).toBe(true);
  });

  it("detects README.md", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "README.md"), "");
    expect(detectMetadata(dir).hasReadme).toBe(true);
  });

  it("detects .env", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, ".env"), "");
    expect(detectMetadata(dir).hasEnvFile).toBe(true);
  });
});

// ── deriveRelevantDomains ────────────────────────────────────────────

describe("deriveRelevantDomains", () => {
  it("maps CI to ci-cd domain", () => {
    const domains = deriveRelevantDomains(
      [{ platform: "gitlab-ci", configPath: ".gitlab-ci.yml" }],
      { hasDockerfile: false, hasCompose: false },
      {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      { hasPrometheus: false, hasNginx: false, hasSystemd: false },
    );
    expect(domains).toContain("ci-cd");
  });

  it("maps GitHub Actions to ci-debugging", () => {
    const domains = deriveRelevantDomains(
      [{ platform: "github-actions", configPath: ".github/workflows/ci.yml" }],
      { hasDockerfile: false, hasCompose: false },
      {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      { hasPrometheus: false, hasNginx: false, hasSystemd: false },
    );
    expect(domains).toContain("ci-cd");
    expect(domains).toContain("ci-debugging");
  });

  it("maps Dockerfile to containerization", () => {
    const domains = deriveRelevantDomains(
      [],
      { hasDockerfile: true, hasCompose: false },
      {
        hasTerraform: false,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      { hasPrometheus: false, hasNginx: false, hasSystemd: false },
    );
    expect(domains).toContain("containerization");
  });

  it("maps Terraform to infrastructure + cloud-architecture", () => {
    const domains = deriveRelevantDomains(
      [],
      { hasDockerfile: false, hasCompose: false },
      {
        hasTerraform: true,
        tfProviders: ["aws"],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: false,
      },
      { hasPrometheus: false, hasNginx: false, hasSystemd: false },
    );
    expect(domains).toContain("infrastructure");
    expect(domains).toContain("cloud-architecture");
  });

  it("deduplicates domains", () => {
    const domains = deriveRelevantDomains(
      [],
      { hasDockerfile: false, hasCompose: false },
      {
        hasTerraform: true,
        tfProviders: [],
        hasState: false,
        hasKubernetes: false,
        hasHelm: false,
        hasAnsible: true,
      },
      { hasPrometheus: false, hasNginx: false, hasSystemd: false },
    );
    const infraCount = domains.filter((d) => d === "infrastructure").length;
    expect(infraCount).toBe(1);
  });
});

// ── scanRepo (integration) ───────────────────────────────────────────

describe("scanRepo", () => {
  it("returns valid RepoContext for a Node.js project", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, "README.md"), "# Test");
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");

    const ctx = scanRepo(dir);

    // Validate against Zod schema
    const parsed = RepoContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);

    expect(ctx.version).toBe(1);
    expect(ctx.rootPath).toBe(dir);
    expect(ctx.primaryLanguage).toBe("node");
    expect(ctx.packageManager?.name).toBe("pnpm");
    expect(ctx.container.hasDockerfile).toBe(true);
    expect(ctx.meta.isGitRepo).toBe(true);
    expect(ctx.meta.hasReadme).toBe(true);
    expect(ctx.relevantDomains).toContain("containerization");
  });

  it("returns valid RepoContext for empty directory", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);

    const parsed = RepoContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);

    expect(ctx.primaryLanguage).toBeNull();
    expect(ctx.packageManager).toBeNull();
    expect(ctx.languages).toEqual([]);
    expect(ctx.ci).toEqual([]);
    expect(ctx.relevantDomains).toEqual([]);
  });

  it("detects multi-app repo with child dirs", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, "backend"));
    fs.writeFileSync(path.join(dir, "backend", "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "backend", "Dockerfile"), "FROM node:20");
    fs.mkdirSync(path.join(dir, "frontend"));
    fs.writeFileSync(path.join(dir, "frontend", "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), "version: '3'");

    const ctx = scanRepo(dir);
    const parsed = RepoContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);

    expect(ctx.languages.length).toBeGreaterThanOrEqual(2);
    expect(ctx.primaryLanguage).toBe("node");
    expect(ctx.container.hasDockerfile).toBe(true);
    expect(ctx.container.hasCompose).toBe(true);
    expect(ctx.meta.isMonorepo).toBe(true);
    expect(ctx.meta.isGitRepo).toBe(true);
  });

  it("does not false-positive Kubernetes from deploy/ without manifests", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "deploy"));
    fs.writeFileSync(path.join(dir, "deploy", "readme.md"), "deployment docs");
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), "version: '3'");

    const ctx = scanRepo(dir);
    expect(ctx.infra.hasKubernetes).toBe(false);
    expect(ctx.relevantDomains).not.toContain("container-orchestration");
  });
});

// ── generateDirectoryTree ────────────────────────────────────────────

describe("generateDirectoryTree", () => {
  it("produces correct tree for a simple project", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "README.md"), "# Hello");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "");

    const tree = generateDirectoryTree(dir);
    expect(tree).toContain("src/");
    expect(tree).toContain("index.ts");
    expect(tree).toContain("package.json");
    expect(tree).toContain("README.md");
  });

  it("skips noise directories", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), "");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "config"), "");
    fs.mkdirSync(path.join(dir, "dist"));
    fs.writeFileSync(path.join(dir, "dist", "bundle.js"), "");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "app.ts"), "");

    const tree = generateDirectoryTree(dir);
    expect(tree).not.toContain("node_modules");
    expect(tree).not.toContain(".git");
    expect(tree).not.toContain("dist");
    expect(tree).toContain("src/");
    expect(tree).toContain("app.ts");
  });

  it("respects depth limit", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a", "b", "c", "deep.txt"), "");

    // maxDepth=1 should show 'a/' but not descend further
    const tree = generateDirectoryTree(dir, 1);
    expect(tree).toContain("a/");
    expect(tree).not.toContain("b/");
    expect(tree).not.toContain("deep.txt");
  });

  it("caps entries at ~200", () => {
    const dir = makeTmpDir();
    // Create 250 files in a flat directory
    for (let i = 0; i < 250; i++) {
      fs.writeFileSync(path.join(dir, `file-${String(i).padStart(3, "0")}.txt`), "");
    }

    const tree = generateDirectoryTree(dir);
    const lines = tree.split("\n");
    // Should be capped (root line + up to 200 entries + possible truncation line)
    expect(lines.length).toBeLessThanOrEqual(203);
    expect(tree).toContain("truncated");
  });
});

// ── enrichWithLLM ───────────────────────────────────────────────────

describe("enrichWithLLM", () => {
  it("calls provider with scan data and returns structured insights", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");

    const mockInsights = {
      projectDescription: "A Node.js web application",
      techStack: ["Node.js", "TypeScript"],
      suggestedWorkflows: [
        { command: 'oda plan "Set up CI/CD"', description: "Create CI pipeline" },
      ],
      recommendedAgents: ["cicd", "docker"],
    };

    const mockProvider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(mockInsights),
        parsed: mockInsights,
      }),
    };

    const ctx = scanRepo(dir);
    const result = await enrichWithLLM(ctx, mockProvider);

    // Verify the provider was called
    expect(mockProvider.generate).toHaveBeenCalledTimes(1);

    // Verify the prompt contains scan data
    const call = vi.mocked(mockProvider.generate).mock.calls[0][0];
    expect(call.system).toContain("DevOps project analyzer");
    expect(call.prompt).toContain("Scan Results");
    expect(call.prompt).toContain("Directory Tree");
    expect(call.prompt).toContain("node"); // detected language
    // rootPath should be stripped from the payload
    expect(call.prompt).not.toContain(dir);
    // Schema should be passed
    expect(call.schema).toBeDefined();

    // Verify result matches schema
    const parsed = LLMInsightsSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.projectDescription).toBe("A Node.js web application");
    expect(result.techStack).toEqual(["Node.js", "TypeScript"]);
    expect(result.recommendedAgents).toContain("cicd");
  });
});

// ── RepoContextSchema with llmInsights ──────────────────────────────

describe("RepoContextSchema with llmInsights", () => {
  it("accepts context without llmInsights", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);
    const parsed = RepoContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);
  });

  it("accepts context with llmInsights", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);
    const withInsights = {
      ...ctx,
      llmInsights: {
        projectDescription: "Test project",
        techStack: ["Node.js"],
        suggestedWorkflows: [{ command: "oda plan", description: "Plan" }],
        recommendedAgents: ["cicd"],
        notes: "Some notes",
      },
    };
    const parsed = RepoContextSchema.safeParse(withInsights);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid llmInsights shape", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);
    const withBadInsights = {
      ...ctx,
      llmInsights: {
        projectDescription: 123, // should be string
      },
    };
    const parsed = RepoContextSchema.safeParse(withBadInsights);
    expect(parsed.success).toBe(false);
  });
});
