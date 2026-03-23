import { describe, it, expect } from "vitest";
import {
  buildPipelineColumns,
  SKILL_MAP,
  STAGE_DISPLAY,
  PARALLEL_STAGES,
} from "../../commands/arise-types";
import type { PipelinePreferences, PipelineStage } from "../../commands/arise-types";
import { renderPipelineDiagram, listPlannedFiles } from "../../commands/arise-diagram";
import type { RepoContext } from "@dojops/core";

// Minimal RepoContext fixture for testing
function makeRepoCtx(overrides: Partial<RepoContext> = {}): RepoContext {
  return {
    version: 2,
    scannedAt: new Date().toISOString(),
    rootPath: "/tmp/test",
    languages: [{ name: "typescript", confidence: 0.9, indicator: "package.json" }],
    primaryLanguage: "typescript",
    packageManager: { name: "pnpm", lockfile: "pnpm-lock.yaml" },
    ci: [],
    container: { hasDockerfile: false, hasCompose: false },
    infra: {
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
    },
    monitoring: {
      hasPrometheus: false,
      hasNginx: false,
      hasSystemd: false,
      hasHaproxy: false,
      hasTomcat: false,
      hasApache: false,
      hasCaddy: false,
      hasEnvoy: false,
    },
    scripts: { shellScripts: [], pythonScripts: [], hasJustfile: false },
    security: {
      hasEnvExample: false,
      hasGitignore: true,
      hasCodeowners: false,
      hasSecurityPolicy: false,
      hasDependabot: false,
      hasRenovate: false,
      hasSecretScanning: false,
      hasEditorConfig: false,
    },
    meta: {
      isGitRepo: true,
      isMonorepo: false,
      hasMakefile: false,
      hasReadme: true,
      hasEnvFile: false,
    },
    relevantDomains: [],
    devopsFiles: [],
    ...overrides,
  } as RepoContext;
}

// ── arise-types tests ────────────────────────────────────────────────

describe("buildPipelineColumns", () => {
  it("returns single build column for build-only", () => {
    const cols = buildPipelineColumns(["build"]);
    expect(cols).toEqual([["build"]]);
  });

  it("groups parallel stages (test, lint, security-scan) into one column", () => {
    const cols = buildPipelineColumns(["build", "test", "lint", "security-scan"]);
    expect(cols).toEqual([["build"], ["test", "lint", "security-scan"]]);
  });

  it("full pipeline has 5 columns", () => {
    const stages: PipelineStage[] = [
      "build",
      "test",
      "lint",
      "security-scan",
      "containerize",
      "publish-artifacts",
      "deploy",
    ];
    const cols = buildPipelineColumns(stages);
    expect(cols).toHaveLength(5);
    expect(cols[0]).toEqual(["build"]);
    expect(cols[1]).toEqual(["test", "lint", "security-scan"]);
    expect(cols[2]).toEqual(["containerize"]);
    expect(cols[3]).toEqual(["publish-artifacts"]);
    expect(cols[4]).toEqual(["deploy"]);
  });

  it("skips build if not selected", () => {
    const cols = buildPipelineColumns(["test", "deploy"]);
    expect(cols).toEqual([["test"], ["deploy"]]);
  });

  it("returns empty for no stages", () => {
    expect(buildPipelineColumns([])).toEqual([]);
  });
});

describe("SKILL_MAP", () => {
  it("maps github-actions to itself", () => {
    expect(SKILL_MAP["github-actions"]).toBe("github-actions");
  });

  it("maps argocd to kubernetes", () => {
    expect(SKILL_MAP.argocd).toBe("kubernetes");
  });

  it("has entries for all CI platforms", () => {
    expect(SKILL_MAP["github-actions"]).toBeDefined();
    expect(SKILL_MAP["gitlab-ci"]).toBeDefined();
    expect(SKILL_MAP.jenkinsfile).toBeDefined();
  });
});

describe("STAGE_DISPLAY", () => {
  const prefs: PipelinePreferences = {
    ciPlatform: "github-actions",
    stages: ["build", "test"],
    envStrategy: "staging-prod",
    notifications: "none",
  };

  it("resolves build tool from package manager", () => {
    const ctx = makeRepoCtx();
    expect(STAGE_DISPLAY.build.toolFn(prefs, ctx)).toBe("pnpm");
  });

  it("resolves test tool for typescript", () => {
    const ctx = makeRepoCtx({ primaryLanguage: "typescript" });
    expect(STAGE_DISPLAY.test.toolFn(prefs, ctx)).toBe("vitest");
  });

  it("resolves test tool for python", () => {
    const ctx = makeRepoCtx({ primaryLanguage: "python" });
    expect(STAGE_DISPLAY.test.toolFn(prefs, ctx)).toBe("pytest");
  });

  it("resolves lint tool for go", () => {
    const ctx = makeRepoCtx({ primaryLanguage: "go" });
    expect(STAGE_DISPLAY.lint.toolFn(prefs, ctx)).toBe("golangci");
  });

  it("resolves security scanner from prefs", () => {
    const scanPrefs = { ...prefs, securityScanner: "trivy" as const };
    expect(STAGE_DISPLAY["security-scan"].toolFn(scanPrefs, makeRepoCtx())).toBe("trivy");
  });

  it("resolves deploy tool from target", () => {
    const helmPrefs = { ...prefs, deployTarget: "helm" as const };
    expect(STAGE_DISPLAY.deploy.toolFn(helmPrefs, makeRepoCtx())).toBe("helm");
  });
});

describe("PARALLEL_STAGES", () => {
  it("contains test, lint, and security-scan", () => {
    expect(PARALLEL_STAGES).toContain("test");
    expect(PARALLEL_STAGES).toContain("lint");
    expect(PARALLEL_STAGES).toContain("security-scan");
  });

  it("does not contain build or deploy", () => {
    expect(PARALLEL_STAGES).not.toContain("build");
    expect(PARALLEL_STAGES).not.toContain("deploy");
  });
});

// ── arise-diagram tests ──────────────────────────────────────────────

describe("renderPipelineDiagram", () => {
  it("renders a linear pipeline for single-item columns", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "containerize", "deploy"],
      deployTarget: "helm",
      envStrategy: "staging-prod",
      notifications: "none",
    };
    const diagram = renderPipelineDiagram(prefs, makeRepoCtx());
    // Should contain box-drawing characters
    expect(diagram).toContain("\u250c"); // top-left corner
    expect(diagram).toContain("\u2518"); // bottom-right corner
    expect(diagram).toContain("Build");
    expect(diagram).toContain("Container");
    expect(diagram).toContain("Deploy");
  });

  it("renders parallel stages when test and lint selected", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "test", "lint"],
      envStrategy: "staging-prod",
      notifications: "none",
    };
    const diagram = renderPipelineDiagram(prefs, makeRepoCtx());
    expect(diagram).toContain("Build");
    expect(diagram).toContain("Test");
    expect(diagram).toContain("Lint");
  });

  it("returns placeholder for empty stages", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: [],
      envStrategy: "single",
      notifications: "none",
    };
    const diagram = renderPipelineDiagram(prefs, makeRepoCtx());
    expect(diagram).toContain("no stages selected");
  });
});

describe("listPlannedFiles", () => {
  it("lists GitHub Actions workflow for github-actions platform", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build"],
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain(".github/workflows/ci.yml");
  });

  it("lists GitLab CI file for gitlab-ci platform", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "gitlab-ci",
      stages: ["build"],
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain(".gitlab-ci.yml");
  });

  it("lists Jenkinsfile for jenkins platform", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "jenkinsfile",
      stages: ["build"],
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("Jenkinsfile");
  });

  it("includes Dockerfile when containerize is selected", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "containerize"],
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("Dockerfile");
    expect(files).toContain(".dockerignore");
  });

  it("includes Helm chart files when deploy target is helm", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "deploy"],
      deployTarget: "helm",
      envStrategy: "staging-prod",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("chart/Chart.yaml");
    expect(files).toContain("chart/values.yaml");
  });

  it("includes K8s manifests when deploy target is kubernetes", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "deploy"],
      deployTarget: "kubernetes",
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("manifests/deployment.yaml");
    expect(files).toContain("manifests/service.yaml");
  });

  it("includes trivy operator when security-scan + k8s deploy", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "security-scan", "deploy"],
      securityScanner: "trivy",
      deployTarget: "kubernetes",
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("manifests/trivy-operator.yaml");
  });

  it("includes falco rules when scanner is falco", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "security-scan"],
      securityScanner: "falco",
      envStrategy: "single",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("falco/falco-rules.yaml");
  });

  it("includes docker-compose files for compose deploy target", () => {
    const prefs: PipelinePreferences = {
      ciPlatform: "github-actions",
      stages: ["build", "deploy"],
      deployTarget: "docker-compose",
      envStrategy: "staging-prod",
      notifications: "none",
    };
    const files = listPlannedFiles(prefs);
    expect(files).toContain("docker-compose.yml");
    expect(files).toContain("docker-compose.prod.yml");
  });
});
