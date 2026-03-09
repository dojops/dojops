import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectLanguages,
  detectPackageManager,
  detectCI,
  detectContainer,
  detectInfra,
  detectMonitoring,
  detectScripts,
  detectSecurity,
  detectMetadata,
  deriveRelevantDomains,
  collectDevopsFiles,
  scanRepo,
  generateDirectoryTree,
  enrichWithLLM,
} from "../../scanner/scanner";
import { RepoContextSchema, RepoContextSchemaV2, LLMInsightsSchema } from "../../scanner/types";
import type { LLMProvider } from "../../llm/provider";

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-scanner-"));
  return tmpDir;
}

/** Create a temp dir, write the given files, and return the dir path. */
function setupDir(files: Record<string, string>, dirs?: string[]): string {
  const dir = makeTmpDir();
  if (dirs) for (const d of dirs) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── detectLanguages ─────────────────────────────────────────────────

describe("detectLanguages", () => {
  it.each([
    ["Node.js", "package.json", "{}", "node", "package.json"],
    ["Python from requirements.txt", "requirements.txt", "", "python", "requirements.txt"],
    ["Python from pyproject.toml", "pyproject.toml", "", "python", "pyproject.toml"],
    ["Go", "go.mod", "", "go", "go.mod"],
    ["Rust", "Cargo.toml", "", "rust", "Cargo.toml"],
    ["Java", "pom.xml", "", "java", "pom.xml"],
    ["Ruby", "Gemfile", "", "ruby", "Gemfile"],
  ] as const)("detects %s from %s", (_label, file, content, expectedName, expectedIndicator) => {
    const dir = setupDir({ [file]: content });
    const result = detectLanguages(dir);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].name).toBe(expectedName);
    expect(result[0].indicator).toBe(expectedIndicator);
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it("detects multiple languages", () => {
    const dir = setupDir({ "package.json": "{}", "go.mod": "" });
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
    const dir = setupDir({ "backend/package.json": "{}", "frontend/package.json": "{}" });
    const result = detectLanguages(dir);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((r) => r.indicator === "backend/package.json")).toBe(true);
    expect(result.some((r) => r.indicator === "frontend/package.json")).toBe(true);
  });

  it("detects different languages across child dirs", () => {
    const dir = setupDir({ "api/go.mod": "", "web/package.json": "{}" });
    const names = detectLanguages(dir).map((r) => r.name);
    expect(names).toContain("go");
    expect(names).toContain("node");
  });

  it("gives child dir detections lower confidence than root", () => {
    const dir = setupDir({ "app/package.json": "{}" });
    expect(detectLanguages(dir)[0].confidence).toBeLessThan(0.9);
  });

  it("skips dotfiles and node_modules dirs", () => {
    const dir = setupDir({ ".hidden/package.json": "{}", "node_modules/package.json": "{}" });
    expect(detectLanguages(dir)).toEqual([]);
  });
});

// ── detectPackageManager ────────────────────────────────────────────

describe("detectPackageManager", () => {
  it.each([
    ["pnpm", "pnpm-lock.yaml", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock", "yarn.lock"],
    ["npm", "package-lock.json", "package-lock.json"],
  ] as const)("detects %s", (name, file, lockfile) => {
    const dir = setupDir({ [file]: "" });
    const result = detectPackageManager(dir);
    expect(result?.name).toBe(name);
    expect(result?.lockfile).toBe(lockfile);
  });

  it("returns null for unknown", () => {
    expect(detectPackageManager(makeTmpDir())).toBeNull();
  });

  it("detects lockfile in child directory when root has none", () => {
    const dir = setupDir({ "backend/package-lock.json": "{}" });
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("npm");
    expect(result?.lockfile).toBe("backend/package-lock.json");
  });

  it("prefers root lockfile over child dir", () => {
    const dir = setupDir({ "pnpm-lock.yaml": "", "app/yarn.lock": "" });
    const result = detectPackageManager(dir);
    expect(result?.name).toBe("pnpm");
    expect(result?.lockfile).toBe("pnpm-lock.yaml");
  });
});

// ── detectCI ─────────────────────────────────────────────────────────

describe("detectCI", () => {
  it("detects GitHub Actions workflows", () => {
    const dir = setupDir({ ".github/workflows/ci.yml": "", ".github/workflows/release.yaml": "" });
    const result = detectCI(dir);
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe("github-actions");
    expect(result[0].configPath).toBe(".github/workflows/ci.yml");
  });

  it.each([
    ["GitLab CI", ".gitlab-ci.yml", "gitlab-ci", ".gitlab-ci.yml"],
    ["Jenkins", "Jenkinsfile", "jenkins", "Jenkinsfile"],
    ["Azure Pipelines", "azure-pipelines.yml", "azure-pipelines", "azure-pipelines.yml"],
    ["Azure Pipelines yaml", "azure-pipelines.yaml", "azure-pipelines", "azure-pipelines.yaml"],
    ["AWS CodeBuild", "buildspec.yml", "aws-codebuild", "buildspec.yml"],
    [
      "Bitbucket Pipelines",
      "bitbucket-pipelines.yml",
      "bitbucket-pipelines",
      "bitbucket-pipelines.yml",
    ],
    ["Drone CI", ".drone.yml", "drone", ".drone.yml"],
    ["Travis CI", ".travis.yml", "travis-ci", ".travis.yml"],
    ["Woodpecker CI from file", ".woodpecker.yml", "woodpecker", ".woodpecker.yml"],
  ] as const)("detects %s", (_label, file, platform, configPath) => {
    const dir = setupDir({ [file]: "" });
    const result = detectCI(dir);
    expect(result[0].platform).toBe(platform);
    expect(result[0].configPath).toBe(configPath);
  });

  it("detects CircleCI", () => {
    const dir = setupDir({ ".circleci/config.yml": "" });
    expect(detectCI(dir)[0].platform).toBe("circleci");
  });

  it("returns empty for no CI", () => {
    expect(detectCI(makeTmpDir())).toEqual([]);
  });

  it("detects Tekton", () => {
    const dir = setupDir({}, [".tekton"]);
    const result = detectCI(dir);
    expect(result[0].platform).toBe("tekton");
    expect(result[0].configPath).toBe(".tekton/");
  });

  it("detects Woodpecker CI from directory", () => {
    const dir = setupDir({}, [".woodpecker"]);
    const result = detectCI(dir);
    expect(result[0].platform).toBe("woodpecker");
    expect(result[0].configPath).toBe(".woodpecker/");
  });

  it("detects GitHub composite actions", () => {
    const dir = makeTmpDir();
    const actionDir = path.join(dir, ".github", "actions", "setup");
    fs.mkdirSync(actionDir, { recursive: true });
    fs.writeFileSync(path.join(actionDir, "action.yml"), "name: setup\nruns:\n  using: composite");
    const result = detectCI(dir);
    expect(result.some((r) => r.platform === "github-composite-action")).toBe(true);
    expect(result.find((r) => r.platform === "github-composite-action")?.configPath).toBe(
      ".github/actions/setup/action.yml",
    );
  });

  it("detects GitHub reusable workflows via workflow_call trigger", () => {
    const dir = makeTmpDir();
    const wfDir = path.join(dir, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(
      path.join(wfDir, "reusable.yml"),
      "on:\n  workflow_call:\n    inputs:\n      env:\n        type: string",
    );
    const result = detectCI(dir);
    expect(result.some((r) => r.platform === "github-actions")).toBe(true);
    expect(result.some((r) => r.platform === "github-reusable-workflow")).toBe(true);
  });

  it("does NOT flag normal workflow as reusable", () => {
    const dir = makeTmpDir();
    const wfDir = path.join(dir, ".github", "workflows");
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, "ci.yml"), "on:\n  push:\n    branches: [main]");
    const result = detectCI(dir);
    expect(result.some((r) => r.platform === "github-reusable-workflow")).toBe(false);
  });
});

// ── detectContainer ──────────────────────────────────────────────────

describe("detectContainer", () => {
  it("detects Dockerfile", () => {
    const result = detectContainer(setupDir({ Dockerfile: "" }));
    expect(result.hasDockerfile).toBe(true);
    expect(result.hasCompose).toBe(false);
  });

  it.each([
    ["docker-compose.yml", "docker-compose.yml"],
    ["compose.yaml", "compose.yaml"],
  ] as const)("detects %s", (file, composePath) => {
    const result = detectContainer(setupDir({ [file]: "" }));
    expect(result.hasCompose).toBe(true);
    expect(result.composePath).toBe(composePath);
  });

  it("returns false for no containers", () => {
    const result = detectContainer(makeTmpDir());
    expect(result.hasDockerfile).toBe(false);
    expect(result.hasCompose).toBe(false);
    expect(result.composePath).toBeUndefined();
  });

  it("detects Dockerfile in child directory", () => {
    expect(detectContainer(setupDir({ "backend/Dockerfile": "FROM node:20" })).hasDockerfile).toBe(
      true,
    );
  });

  it("detects Docker Swarm from docker-stack.yml", () => {
    const dir = setupDir({
      "docker-stack.yml": "version: '3.8'\nservices:\n  web:\n    image: nginx",
    });
    expect(detectContainer(dir).hasSwarm).toBe(true);
  });

  it("detects Docker Swarm from compose file with deploy config", () => {
    const dir = setupDir({
      "docker-compose.yml":
        "version: '3.8'\nservices:\n  web:\n    image: nginx\n    deploy:\n     replicas: 3",
    });
    const result = detectContainer(dir);
    expect(result.hasSwarm).toBe(true);
    expect(result.hasCompose).toBe(true);
  });

  it("does NOT detect Docker Swarm from plain compose file", () => {
    const dir = setupDir({
      "docker-compose.yml":
        "version: '3'\nservices:\n  web:\n    image: nginx\n    ports:\n      - '80:80'",
    });
    expect(detectContainer(dir).hasSwarm).toBe(false);
  });
});

// ── detectInfra ──────────────────────────────────────────────────────

describe("detectInfra", () => {
  it("detects Terraform files", () => {
    const result = detectInfra(setupDir({ "main.tf": 'provider "aws" {}' }));
    expect(result.hasTerraform).toBe(true);
    expect(result.tfProviders).toContain("aws");
  });

  it("detects multiple Terraform providers", () => {
    const result = detectInfra(setupDir({ "main.tf": 'provider "aws" {}\nprovider "google" {}' }));
    expect(result.tfProviders).toContain("aws");
    expect(result.tfProviders).toContain("gcp");
  });

  it("detects terraform state", () => {
    const result = detectInfra(setupDir({ "main.tf": "", "terraform.tfstate": "{}" }));
    expect(result.hasState).toBe(true);
  });

  it.each(["k8s", "kubernetes"])("detects Kubernetes from %s directory", (dirName) => {
    expect(detectInfra(setupDir({}, [dirName])).hasKubernetes).toBe(true);
  });

  it("does NOT detect Kubernetes from deploy/ without k8s content", () => {
    expect(detectInfra(setupDir({ "deploy/notes.txt": "just some notes" })).hasKubernetes).toBe(
      false,
    );
  });

  it("detects Kubernetes from deploy/ with k8s manifests", () => {
    const dir = setupDir({
      "deploy/service.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: myapp",
    });
    expect(detectInfra(dir).hasKubernetes).toBe(true);
  });

  it("does NOT detect Kubernetes from manifests/ without k8s content", () => {
    expect(detectInfra(setupDir({ "manifests/data.yaml": "key: value" })).hasKubernetes).toBe(
      false,
    );
  });

  it.each([
    ["Helm", "Chart.yaml", "hasHelm"],
    ["Ansible", "playbook.yml", "hasAnsible"],
    ["Kustomize from kustomization.yaml", "kustomization.yaml", "hasKustomize"],
    ["Kustomize from kustomization.yml", "kustomization.yml", "hasKustomize"],
    ["Vagrant", "Vagrantfile", "hasVagrant"],
    ["Pulumi", "Pulumi.yaml", "hasPulumi"],
  ] as const)("detects %s", (_label, file, prop) => {
    expect((detectInfra(setupDir({ [file]: "" })) as Record<string, unknown>)[prop]).toBe(true);
  });

  it("returns defaults for empty directory", () => {
    const result = detectInfra(makeTmpDir());
    expect(result.hasTerraform).toBe(false);
    expect(result.tfProviders).toEqual([]);
    expect(result.hasState).toBe(false);
    expect(result.hasKubernetes).toBe(false);
    expect(result.hasHelm).toBe(false);
    expect(result.hasAnsible).toBe(false);
    expect(result.hasKustomize).toBe(false);
    expect(result.hasVagrant).toBe(false);
    expect(result.hasPulumi).toBe(false);
    expect(result.hasCloudFormation).toBe(false);
    expect(result.hasPacker).toBe(false);
  });

  it("detects CloudFormation from cloudformation/ directory", () => {
    expect(detectInfra(setupDir({}, ["cloudformation"])).hasCloudFormation).toBe(true);
  });

  it("detects CloudFormation from .cfn.yml file", () => {
    expect(detectInfra(setupDir({ "stack.cfn.yml": "" })).hasCloudFormation).toBe(true);
  });

  it("detects CloudFormation from template.yaml with AWSTemplateFormatVersion", () => {
    const dir = setupDir({
      "template.yaml": "AWSTemplateFormatVersion: '2010-09-09'\nDescription: My stack",
    });
    expect(detectInfra(dir).hasCloudFormation).toBe(true);
  });

  it("does NOT detect CloudFormation from template.yaml without AWS content", () => {
    expect(
      detectInfra(setupDir({ "template.yaml": "key: value\nfoo: bar" })).hasCloudFormation,
    ).toBe(false);
  });

  it.each([
    ["Packer from .pkr.hcl", "ubuntu.pkr.hcl", 'source "amazon-ebs" "ubuntu" {}'],
    ["Packer from packer.json", "packer.json", "{}"],
    ["Packer from .pkr.json", "ubuntu.pkr.json", "{}"],
  ] as const)("detects %s file", (_label, file, content) => {
    expect(detectInfra(setupDir({ [file]: content })).hasPacker).toBe(true);
  });
});

// ── detectMonitoring ─────────────────────────────────────────────────

describe("detectMonitoring", () => {
  it.each([
    ["Prometheus", "prometheus.yml", "hasPrometheus"],
    ["Nginx", "nginx.conf", "hasNginx"],
    ["systemd .service", "myapp.service", "hasSystemd"],
    ["HAProxy", "haproxy.cfg", "hasHaproxy"],
    ["Tomcat", "server.xml", "hasTomcat"],
    ["Apache from httpd.conf", "httpd.conf", "hasApache"],
    ["Apache from .htaccess", ".htaccess", "hasApache"],
    ["Caddy", "Caddyfile", "hasCaddy"],
    ["Envoy", "envoy.yaml", "hasEnvoy"],
  ] as const)("detects %s", (_label, file, prop) => {
    expect((detectMonitoring(setupDir({ [file]: "" })) as Record<string, unknown>)[prop]).toBe(
      true,
    );
  });

  it("returns all false for empty", () => {
    const result = detectMonitoring(makeTmpDir());
    expect(result.hasPrometheus).toBe(false);
    expect(result.hasNginx).toBe(false);
    expect(result.hasSystemd).toBe(false);
    expect(result.hasHaproxy).toBe(false);
    expect(result.hasTomcat).toBe(false);
    expect(result.hasApache).toBe(false);
    expect(result.hasCaddy).toBe(false);
    expect(result.hasEnvoy).toBe(false);
  });
});

// ── detectScripts ────────────────────────────────────────────────────

describe("detectScripts", () => {
  it("detects shell scripts at root", () => {
    expect(detectScripts(setupDir({ "deploy.sh": "#!/bin/bash" })).shellScripts).toContain(
      "deploy.sh",
    );
  });

  it("detects python scripts at root", () => {
    expect(detectScripts(setupDir({ "build.py": "" })).pythonScripts).toContain("build.py");
  });

  it("detects scripts in scripts/ directory", () => {
    const result = detectScripts(setupDir({ "scripts/setup.sh": "", "scripts/migrate.py": "" }));
    expect(result.shellScripts).toContain("scripts/setup.sh");
    expect(result.pythonScripts).toContain("scripts/migrate.py");
  });

  it("detects Justfile", () => {
    expect(detectScripts(setupDir({ Justfile: "" })).hasJustfile).toBe(true);
  });

  it("returns empty for empty directory", () => {
    const result = detectScripts(makeTmpDir());
    expect(result.shellScripts).toEqual([]);
    expect(result.pythonScripts).toEqual([]);
    expect(result.hasJustfile).toBe(false);
  });
});

// ── detectSecurity ───────────────────────────────────────────────────

describe("detectSecurity", () => {
  it.each([
    [".env.example", ".env.example", "hasEnvExample"],
    [".gitignore", ".gitignore", "hasGitignore"],
    ["CODEOWNERS at root", "CODEOWNERS", "hasCodeowners"],
    ["CODEOWNERS in .github/", ".github/CODEOWNERS", "hasCodeowners"],
    ["SECURITY.md", "SECURITY.md", "hasSecurityPolicy"],
    ["Dependabot config", ".github/dependabot.yml", "hasDependabot"],
    ["Renovate config", "renovate.json", "hasRenovate"],
    [".editorconfig", ".editorconfig", "hasEditorConfig"],
  ] as const)("detects %s", (_label, file, prop) => {
    expect((detectSecurity(setupDir({ [file]: "" })) as Record<string, unknown>)[prop]).toBe(true);
  });

  it("returns all false for empty directory", () => {
    const result = detectSecurity(makeTmpDir());
    expect(result.hasEnvExample).toBe(false);
    expect(result.hasGitignore).toBe(false);
    expect(result.hasCodeowners).toBe(false);
    expect(result.hasSecurityPolicy).toBe(false);
    expect(result.hasDependabot).toBe(false);
    expect(result.hasRenovate).toBe(false);
    expect(result.hasSecretScanning).toBe(false);
    expect(result.hasEditorConfig).toBe(false);
  });
});

// ── detectMetadata ───────────────────────────────────────────────────

describe("detectMetadata", () => {
  it("detects git repo", () => {
    expect(detectMetadata(setupDir({}, [".git"])).isGitRepo).toBe(true);
  });

  it("detects monorepo from pnpm-workspace.yaml", () => {
    expect(detectMetadata(setupDir({ "pnpm-workspace.yaml": "" })).isMonorepo).toBe(true);
  });

  it("detects multi-app repo as monorepo", () => {
    expect(
      detectMetadata(setupDir({ "backend/package.json": "{}", "frontend/package.json": "{}" }))
        .isMonorepo,
    ).toBe(true);
  });

  it("does not flag single child app as monorepo", () => {
    expect(detectMetadata(setupDir({ "app/package.json": "{}" })).isMonorepo).toBe(false);
  });

  it.each([
    ["Makefile", "Makefile", "hasMakefile"],
    ["README.md", "README.md", "hasReadme"],
    [".env", ".env", "hasEnvFile"],
  ] as const)("detects %s", (_label, file, prop) => {
    expect((detectMetadata(setupDir({ [file]: "" })) as Record<string, unknown>)[prop]).toBe(true);
  });
});

// ── deriveRelevantDomains ────────────────────────────────────────────

describe("deriveRelevantDomains", () => {
  const emptyInfra: InfraDetection = {
    hasTerraform: false,
    tfProviders: [],
    hasState: false,
    hasKubernetes: false,
    hasHelm: false,
    hasAnsible: false,
    hasKustomize: false,
    hasVagrant: false,
    hasPulumi: false,
    hasCloudFormation: false,
  };
  const emptyMonitoring: MonitoringDetection = {
    hasPrometheus: false,
    hasNginx: false,
    hasSystemd: false,
    hasHaproxy: false,
    hasTomcat: false,
    hasApache: false,
    hasCaddy: false,
    hasEnvoy: false,
  };
  const emptyContainer: ContainerDetection = { hasDockerfile: false, hasCompose: false };

  // Need to import types for the helper
  type InfraDetection = import("./types").InfraDetection;
  type MonitoringDetection = import("./types").MonitoringDetection;
  type ContainerDetection = import("./types").ContainerDetection;

  it("maps CI to ci-cd domain", () => {
    const domains = deriveRelevantDomains(
      [{ platform: "gitlab-ci", configPath: ".gitlab-ci.yml" }],
      emptyContainer,
      emptyInfra,
      emptyMonitoring,
    );
    expect(domains).toContain("ci-cd");
  });

  it("maps GitHub Actions to ci-debugging", () => {
    const domains = deriveRelevantDomains(
      [{ platform: "github-actions", configPath: ".github/workflows/ci.yml" }],
      emptyContainer,
      emptyInfra,
      emptyMonitoring,
    );
    expect(domains).toContain("ci-cd");
    expect(domains).toContain("ci-debugging");
  });

  it("maps Dockerfile to containerization", () => {
    const domains = deriveRelevantDomains(
      [],
      { hasDockerfile: true, hasCompose: false },
      emptyInfra,
      emptyMonitoring,
    );
    expect(domains).toContain("containerization");
  });

  it("maps Terraform to infrastructure + cloud-architecture", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      { ...emptyInfra, hasTerraform: true, tfProviders: ["aws"] },
      emptyMonitoring,
    );
    expect(domains).toContain("infrastructure");
    expect(domains).toContain("cloud-architecture");
  });

  it("deduplicates domains", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      { ...emptyInfra, hasTerraform: true, hasAnsible: true },
      emptyMonitoring,
    );
    const infraCount = domains.filter((d) => d === "infrastructure").length;
    expect(infraCount).toBe(1);
  });

  it("maps Kustomize to container-orchestration", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      { ...emptyInfra, hasKustomize: true },
      emptyMonitoring,
    );
    expect(domains).toContain("container-orchestration");
  });

  it("maps Pulumi to infrastructure + cloud-architecture", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      { ...emptyInfra, hasPulumi: true },
      emptyMonitoring,
    );
    expect(domains).toContain("infrastructure");
    expect(domains).toContain("cloud-architecture");
  });

  it("maps CloudFormation to infrastructure + cloud-architecture", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      { ...emptyInfra, hasCloudFormation: true },
      emptyMonitoring,
    );
    expect(domains).toContain("infrastructure");
    expect(domains).toContain("cloud-architecture");
  });

  it("maps HAProxy to networking", () => {
    const domains = deriveRelevantDomains([], emptyContainer, emptyInfra, {
      ...emptyMonitoring,
      hasHaproxy: true,
    });
    expect(domains).toContain("networking");
  });

  it("maps shell scripts to shell-scripting", () => {
    const domains = deriveRelevantDomains([], emptyContainer, emptyInfra, emptyMonitoring, {
      shellScripts: ["deploy.sh"],
      pythonScripts: [],
      hasJustfile: false,
    });
    expect(domains).toContain("shell-scripting");
  });

  it("maps python scripts to python-scripting", () => {
    const domains = deriveRelevantDomains([], emptyContainer, emptyInfra, emptyMonitoring, {
      shellScripts: [],
      pythonScripts: ["build.py"],
      hasJustfile: false,
    });
    expect(domains).toContain("python-scripting");
  });

  it("maps security configs to security domain", () => {
    const domains = deriveRelevantDomains(
      [],
      emptyContainer,
      emptyInfra,
      emptyMonitoring,
      undefined,
      {
        hasEnvExample: false,
        hasGitignore: false,
        hasCodeowners: false,
        hasSecurityPolicy: true,
        hasDependabot: false,
        hasRenovate: false,
        hasSecretScanning: false,
        hasEditorConfig: false,
      },
    );
    expect(domains).toContain("security");
  });
});

// ── collectDevopsFiles ───────────────────────────────────────────────

describe("collectDevopsFiles", () => {
  it("collects CI config paths", () => {
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".github", "workflows", "ci.yml"), "");
    const ci = detectCI(dir);
    const emptyInfra = detectInfra(dir);
    const emptyMon = detectMonitoring(dir);
    const emptyScripts = detectScripts(dir);
    const emptySecurity = detectSecurity(dir);
    const files = collectDevopsFiles(
      ci,
      detectContainer(dir),
      emptyInfra,
      emptyMon,
      emptyScripts,
      emptySecurity,
      dir,
    );
    expect(files).toContain(".github/workflows/ci.yml");
  });

  it("collects Dockerfiles and compose files", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), "");
    const container = detectContainer(dir);
    const files = collectDevopsFiles(
      [],
      container,
      detectInfra(dir),
      detectMonitoring(dir),
      detectScripts(dir),
      detectSecurity(dir),
      dir,
    );
    expect(files).toContain("Dockerfile");
    expect(files).toContain("docker-compose.yml");
  });

  it("collects terraform files", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), "");
    fs.writeFileSync(path.join(dir, "vars.tf"), "");
    const infra = detectInfra(dir);
    const files = collectDevopsFiles(
      [],
      detectContainer(dir),
      infra,
      detectMonitoring(dir),
      detectScripts(dir),
      detectSecurity(dir),
      dir,
    );
    expect(files).toContain("main.tf");
    expect(files).toContain("vars.tf");
  });
});

// ── scanRepo (integration) ───────────────────────────────────────────

describe("scanRepo", () => {
  it("returns valid V2 RepoContext for a Node.js project", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, "README.md"), "# Test");
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");

    const ctx = scanRepo(dir);

    // Validate against V2 schema
    const parsed = RepoContextSchemaV2.safeParse(ctx);
    expect(parsed.success).toBe(true);

    // Also valid via union
    const unionParsed = RepoContextSchema.safeParse(ctx);
    expect(unionParsed.success).toBe(true);

    expect(ctx.version).toBe(2);
    expect(ctx.rootPath).toBe(dir);
    expect(ctx.primaryLanguage).toBe("node");
    expect(ctx.packageManager?.name).toBe("pnpm");
    expect(ctx.container.hasDockerfile).toBe(true);
    expect(ctx.meta.isGitRepo).toBe(true);
    expect(ctx.meta.hasReadme).toBe(true);
    expect(ctx.relevantDomains).toContain("containerization");
    expect(ctx.devopsFiles).toContain("Dockerfile");
  });

  it("returns valid RepoContext for empty directory", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);

    const parsed = RepoContextSchemaV2.safeParse(ctx);
    expect(parsed.success).toBe(true);

    expect(ctx.version).toBe(2);
    expect(ctx.primaryLanguage).toBeNull();
    expect(ctx.packageManager).toBeNull();
    expect(ctx.languages).toEqual([]);
    expect(ctx.ci).toEqual([]);
    expect(ctx.relevantDomains).toEqual([]);
    expect(ctx.devopsFiles).toEqual([]);
    expect(ctx.scripts.shellScripts).toEqual([]);
    expect(ctx.scripts.pythonScripts).toEqual([]);
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
    const parsed = RepoContextSchemaV2.safeParse(ctx);
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

  it("includes scripts and security in V2 context", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "deploy.sh"), "#!/bin/bash");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules");
    fs.writeFileSync(path.join(dir, ".editorconfig"), "");

    const ctx = scanRepo(dir);
    expect(ctx.scripts.shellScripts).toContain("deploy.sh");
    expect(ctx.security.hasGitignore).toBe(true);
    expect(ctx.security.hasEditorConfig).toBe(true);
    expect(ctx.devopsFiles).toContain("deploy.sh");
    expect(ctx.devopsFiles).toContain(".gitignore");
  });

  it("collects devopsFiles from multiple detection categories", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");
    fs.writeFileSync(path.join(dir, "nginx.conf"), "");
    fs.writeFileSync(path.join(dir, "deploy.sh"), "");
    fs.writeFileSync(path.join(dir, ".gitignore"), "");

    const ctx = scanRepo(dir);
    expect(ctx.devopsFiles).toContain("Dockerfile");
    expect(ctx.devopsFiles).toContain("nginx.conf");
    expect(ctx.devopsFiles).toContain("deploy.sh");
    expect(ctx.devopsFiles).toContain(".gitignore");
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
    const lines = tree.split("\n");
    expect(tree).toContain("a/");
    // Check no line has "b/" as a tree entry (avoid matching temp dir name like "dojops-scanner-XXb/")
    expect(lines.some((l) => l.includes("── b/"))).toBe(false);
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
  it("calls provider twice (metadata + analysis) and returns combined insights", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");

    const mockMetadata = {
      projectDescription: "A Node.js web application",
      techStack: ["Node.js", "TypeScript"],
      suggestedWorkflows: [
        { command: 'dojops plan "Set up CI/CD"', description: "Create CI pipeline" },
      ],
      recommendedAgents: ["cicd", "docker"],
    };

    const mockAnalysis = "## Commands\n\n```bash\nnpm test\n```\n\n## Architecture\n\nNode.js app.";

    const mockProvider: LLMProvider = {
      name: "mock",
      generate: vi
        .fn()
        // First call: metadata (JSON)
        .mockResolvedValueOnce({
          content: JSON.stringify(mockMetadata),
          parsed: mockMetadata,
        })
        // Second call: analysis (plain markdown)
        .mockResolvedValueOnce({
          content: mockAnalysis,
        }),
    };

    const ctx = scanRepo(dir);
    const result = await enrichWithLLM(ctx, mockProvider);

    // Verify two separate calls (metadata + analysis)
    expect(mockProvider.generate).toHaveBeenCalledTimes(2);

    // First call: structured metadata with schema
    const metadataCall = vi.mocked(mockProvider.generate).mock.calls[0][0];
    expect(metadataCall.system).toContain("structured JSON insights");
    expect(metadataCall.schema).toBeDefined();

    // Second call: plain markdown analysis without schema
    const analysisCall = vi.mocked(mockProvider.generate).mock.calls[1][0];
    expect(analysisCall.system).toContain("comprehensive project analysis");
    expect(analysisCall.schema).toBeUndefined();

    // Both calls should contain scan data and not expose rootPath
    for (const call of vi.mocked(mockProvider.generate).mock.calls) {
      expect(call[0].prompt).toContain("Scan Results");
      expect(call[0].prompt).toContain("Directory Tree");
      expect(call[0].prompt).not.toContain(dir);
    }

    // Verify result matches schema
    const parsed = LLMInsightsSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    expect(result.projectDescription).toBe("A Node.js web application");
    expect(result.techStack).toEqual(["Node.js", "TypeScript"]);
    expect(result.recommendedAgents).toContain("cicd");
    expect(result.projectAnalysis).toBe(mockAnalysis);
  });
});

// ── RepoContextSchema with llmInsights ──────────────────────────────

describe("RepoContextSchema with llmInsights", () => {
  it("accepts V2 context without llmInsights", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);
    const parsed = RepoContextSchema.safeParse(ctx);
    expect(parsed.success).toBe(true);
  });

  it("accepts V2 context with llmInsights", () => {
    const dir = makeTmpDir();
    const ctx = scanRepo(dir);
    const withInsights = {
      ...ctx,
      llmInsights: {
        projectDescription: "Test project",
        techStack: ["Node.js"],
        suggestedWorkflows: [{ command: "dojops plan", description: "Plan" }],
        recommendedAgents: ["cicd"],
        notes: "Some notes",
      },
    };
    const parsed = RepoContextSchema.safeParse(withInsights);
    expect(parsed.success).toBe(true);
  });

  it("accepts recommendedAgents as objects with various field names", () => {
    const data = {
      projectDescription: "Test",
      techStack: [],
      suggestedWorkflows: [],
      recommendedAgents: [
        { agent: "terraform", reason: "uses HCL" },
        { name: "cicd", description: "has workflows" },
        { value: "docker" },
        "kubernetes",
      ],
    };
    const parsed = LLMInsightsSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recommendedAgents).toEqual(["terraform", "cicd", "docker", "kubernetes"]);
    }
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
    const parsed = RepoContextSchemaV2.safeParse(withBadInsights);
    expect(parsed.success).toBe(false);
  });
});

// ── Subdirectory detection (C1/M2 audit fixes) ─────────────────────

describe("detectInfra — subdirectory scanning", () => {
  it.each([
    [
      "Terraform in terraform/",
      "terraform/main.tf",
      'provider "vultr" {}',
      "hasTerraform",
      ["vultr"],
    ],
    ["Terraform in infra/", "infra/main.tf", "resource {}", "hasTerraform", undefined],
    [
      "Terraform in terraform-iac/",
      "terraform-iac/main.tf",
      'provider "cloudflare" {}',
      "hasTerraform",
      ["cloudflare"],
    ],
    ["Helm in subdirectory", "helm/Chart.yaml", "name: my-chart", "hasHelm", undefined],
    ["Ansible in subdirectory", "ansible/playbook.yml", "---", "hasAnsible", undefined],
    [
      "Kustomize in subdirectory",
      "deploy/kustomization.yaml",
      "resources: []",
      "hasKustomize",
      undefined,
    ],
    ["Packer in subdirectory", "packer/image.pkr.hcl", "source {}", "hasPacker", undefined],
  ] as const)("detects %s", (_label, file, content, prop, providers) => {
    const result = detectInfra(setupDir({ [file]: content }));
    expect((result as Record<string, unknown>)[prop]).toBe(true);
    if (providers) {
      for (const p of providers) expect(result.tfProviders).toContain(p);
    }
  });
});

describe("detectMonitoring — subdirectory scanning", () => {
  it.each([
    ["Prometheus", "monitoring/prometheus.yml", "global:", "hasPrometheus"],
    ["Nginx", "nginx/nginx.conf", "server {}", "hasNginx"],
    ["systemd .service", "systemd/myapp.service", "[Unit]", "hasSystemd"],
  ] as const)("detects %s in subdirectory", (_label, file, content, prop) => {
    expect((detectMonitoring(setupDir({ [file]: content })) as Record<string, unknown>)[prop]).toBe(
      true,
    );
  });
});

describe("detectScripts — subdirectory scanning", () => {
  it.each([
    ["child directories", "app/deploy.sh", "app/deploy.sh"],
    ["child/scripts/ subdirectory", "app/scripts/build.sh", "app/scripts/build.sh"],
  ] as const)("detects shell scripts in %s", (_label, file, expected) => {
    expect(detectScripts(setupDir({ [file]: "#!/bin/bash" })).shellScripts).toContain(expected);
  });
});

describe("detectLanguages — expanded indicators", () => {
  it("detects TypeScript from tsconfig.json", () => {
    expect(
      detectLanguages(setupDir({ "tsconfig.json": "{}" })).some((l) => l.name === "typescript"),
    ).toBe(true);
  });

  it("TypeScript has lower confidence than Node.js", () => {
    const result = detectLanguages(setupDir({ "package.json": "{}", "tsconfig.json": "{}" }));
    const node = result.find((l) => l.name === "node");
    const ts = result.find((l) => l.name === "typescript");
    expect(node).toBeDefined();
    expect(ts).toBeDefined();
    expect(node!.confidence).toBeGreaterThan(ts!.confidence);
  });

  it.each([
    ["PHP", "composer.json", "{}", "php"],
    [".NET", "MyApp.csproj", "<Project/>", "dotnet"],
    ["Elixir", "mix.exs", "defmodule Mix {}", "elixir"],
  ] as const)("detects %s from %s", (_label, file, content, lang) => {
    expect(detectLanguages(setupDir({ [file]: content })).some((l) => l.name === lang)).toBe(true);
  });
});

describe("TF provider patterns — expanded", () => {
  it.each([
    ["vultr", 'provider "vultr" { api_key = var.key }', "vultr"],
    ["digitalocean", 'provider "digitalocean" {}', "digitalocean"],
    ["cloudflare", 'provider "cloudflare" {}', "cloudflare"],
    ["kubernetes", 'provider "kubernetes" {}', "kubernetes"],
  ] as const)("detects %s provider", (_label, content, expected) => {
    expect(detectInfra(setupDir({ "main.tf": content })).tfProviders).toContain(expected);
  });

  it("detects providers in subdirectory .tf files", () => {
    const result = detectInfra(
      setupDir({ "terraform/main.tf": 'provider "hcloud" { token = var.hc_token }' }),
    );
    expect(result.hasTerraform).toBe(true);
    expect(result.tfProviders).toContain("hetzner");
  });
});

// ── B1: detectScripts skips "scripts" in child loop ──────────────
describe("detectScripts — B1 dedup fix", () => {
  it("does not duplicate scripts/ entries via child loop", () => {
    const result = detectScripts(setupDir({ "scripts/deploy.sh": "#!/bin/bash" }));
    expect(result.shellScripts.filter((s) => s === "scripts/deploy.sh")).toHaveLength(1);
  });
});

// ── S1: listChildDirs ignores symlinks ───────────────────────────
describe("detectInfra — S1 symlink safety", () => {
  it("ignores symlinked child directories", () => {
    const dir = makeTmpDir();
    const realDir = path.join(dir, "real-tf");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "main.tf"), 'provider "aws" {}');
    // Create symlink child pointing to real-tf
    fs.symlinkSync(realDir, path.join(dir, "link-tf"));
    const result = detectInfra(dir);
    // Should only detect from real-tf, not from link-tf
    expect(result.hasTerraform).toBe(true);
    // The symlinked dir should be ignored by listChildDirs
    expect(result.tfProviders.filter((p) => p === "aws")).toHaveLength(1);
  });
});

// ── S6: TF provider does not match comments ──────────────────────
describe("scanTfDir — S6 comment stripping", () => {
  it("ignores provider declarations in HCL comments", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(
      path.join(dir, "main.tf"),
      '# provider "aws" {}\n// provider "gcp" {}\nresource "null_resource" "x" {}',
    );
    const result = detectInfra(dir);
    expect(result.hasTerraform).toBe(true);
    expect(result.tfProviders).not.toContain("aws");
    expect(result.tfProviders).not.toContain("gcp");
  });
});

// ── F3-F4: CDK and Skaffold detection ────────────────────────────
describe("detectInfra — CDK and Skaffold", () => {
  it.each([
    ["CDK from cdk.json at root", "cdk.json", '{"app":"npx ts-node"}', "hasCdk"],
    ["CDK from cdk.json in subdirectory", "infra/cdk.json", "{}", "hasCdk"],
    [
      "Skaffold from skaffold.yaml at root",
      "skaffold.yaml",
      "apiVersion: skaffold/v2",
      "hasSkaffold",
    ],
  ] as const)("detects %s", (_label, file, content, prop) => {
    expect((detectInfra(setupDir({ [file]: content })) as Record<string, unknown>)[prop]).toBe(
      true,
    );
  });

  it("returns false when neither CDK nor Skaffold present", () => {
    const result = detectInfra(makeTmpDir());
    expect(result.hasCdk).toBe(false);
    expect(result.hasSkaffold).toBe(false);
  });
});

// ── F5-F6: New language detection ────────────────────────────────
describe("detectLanguages — expanded indicators", () => {
  it.each([
    ["C/C++", "CMakeLists.txt", "cmake_minimum_required(VERSION 3.10)", "c-cpp"],
    ["Scala", "build.sbt", 'name := "hello"', "scala"],
    ["Haskell", "stack.yaml", "resolver: lts-20.0", "haskell"],
    ["Zig", "build.zig", 'const std = @import("std");', "zig"],
  ] as const)("detects %s from %s", (_label, file, content, lang) => {
    expect(detectLanguages(setupDir({ [file]: content })).some((l) => l.name === lang)).toBe(true);
  });
});

// ── F7-F8: ArgoCD and Tiltfile detection ─────────────────────────
describe("detectInfra — ArgoCD and Tiltfile", () => {
  it("detects ArgoCD from .argocd/ directory", () => {
    expect(detectInfra(setupDir({}, [".argocd"])).hasArgoCD).toBe(true);
  });

  it("detects Tiltfile at root", () => {
    expect(detectInfra(setupDir({ Tiltfile: "k8s_yaml('deploy.yaml')" })).hasTiltfile).toBe(true);
  });

  it("returns false when neither ArgoCD nor Tiltfile present", () => {
    const result = detectInfra(makeTmpDir());
    expect(result.hasArgoCD).toBe(false);
    expect(result.hasTiltfile).toBe(false);
  });
});

// ── F10: .bash extension detection ───────────────────────────────
describe("detectScripts — F10 .bash extension", () => {
  it("detects .bash files as shell scripts", () => {
    expect(detectScripts(setupDir({ "setup.bash": "#!/bin/bash" })).shellScripts).toContain(
      "setup.bash",
    );
  });
});

// ── F11: Helmfile detection ──────────────────────────────────────
describe("detectInfra — Helmfile", () => {
  it.each([
    ["helmfile.yaml at root", "helmfile.yaml"],
    ["helmfile.yml in subdirectory", "deploy/helmfile.yml"],
  ] as const)("detects %s", (_label, file) => {
    expect(detectInfra(setupDir({ [file]: "releases: []" })).hasHelmfile).toBe(true);
  });

  it("returns false when no helmfile present", () => {
    expect(detectInfra(makeTmpDir()).hasHelmfile).toBe(false);
  });
});

// ── F12: Concourse CI and TeamCity detection ─────────────────────
describe("detectCI — Concourse and TeamCity", () => {
  it.each([
    ["Concourse", ".concourse", "concourse"],
    ["TeamCity", ".teamcity", "teamcity"],
  ] as const)("detects %s from %s/ directory", (_label, dirName, platform) => {
    expect(detectCI(setupDir({}, [dirName])).some((c) => c.platform === platform)).toBe(true);
  });
});
