import type { RepoContext } from "@dojops/core";

// ── Pipeline preference types ────────────────────────────────────────

export type CIPlatform = "github-actions" | "gitlab-ci" | "jenkinsfile";

export type PipelineStage =
  | "build"
  | "test"
  | "lint"
  | "security-scan"
  | "containerize"
  | "publish-artifacts"
  | "deploy";

export type ContainerRegistry = "dockerhub" | "ghcr" | "ecr" | "gcr" | "jfrog" | "nexus";

export type SecurityScanner = "trivy" | "snyk" | "grype" | "falco";

export type DeployTarget =
  | "kubernetes"
  | "helm"
  | "docker-compose"
  | "bare-metal"
  | "serverless"
  | "ecs"
  | "argocd";

export type EnvStrategy = "single" | "staging-prod" | "dev-staging-prod";

export type NotificationTarget = "slack" | "email" | "none";

export interface PipelinePreferences {
  ciPlatform: CIPlatform;
  stages: PipelineStage[];
  containerRegistry?: ContainerRegistry;
  securityScanner?: SecurityScanner;
  deployTarget?: DeployTarget;
  envStrategy: EnvStrategy;
  notifications: NotificationTarget;
}

// ── Skill mapping ────────────────────────────────────────────────────

/** Maps a user selection key to the .dops skill name used for generation. */
export const SKILL_MAP: Record<string, string> = {
  "github-actions": "github-actions",
  "gitlab-ci": "gitlab-ci",
  jenkinsfile: "jenkinsfile",
  dockerfile: "dockerfile",
  "docker-compose": "docker-compose",
  kubernetes: "kubernetes",
  helm: "helm",
  "trivy-operator": "trivy-operator",
  falco: "falco",
  prometheus: "prometheus",
  makefile: "makefile",
  nginx: "nginx",
  argocd: "kubernetes",
};

// ── Stage display metadata ───────────────────────────────────────────

export interface StageDisplay {
  label: string;
  toolFn: (prefs: PipelinePreferences, ctx: RepoContext) => string;
}

export const STAGE_DISPLAY: Record<PipelineStage, StageDisplay> = {
  build: {
    label: "Build",
    toolFn: (_p, ctx) => ctx.packageManager?.name ?? "make",
  },
  test: {
    label: "Test",
    toolFn: (_p, ctx) => {
      const lang = ctx.primaryLanguage;
      if (lang === "typescript" || lang === "javascript") return "vitest";
      if (lang === "python") return "pytest";
      if (lang === "go") return "go test";
      if (lang === "java") return "maven";
      if (lang === "rust") return "cargo";
      return "test";
    },
  },
  lint: {
    label: "Lint",
    toolFn: (_p, ctx) => {
      const lang = ctx.primaryLanguage;
      if (lang === "typescript" || lang === "javascript") return "eslint";
      if (lang === "python") return "ruff";
      if (lang === "go") return "golangci";
      if (lang === "rust") return "clippy";
      return "lint";
    },
  },
  "security-scan": {
    label: "Scan",
    toolFn: (prefs) => prefs.securityScanner ?? "trivy",
  },
  containerize: {
    label: "Container",
    toolFn: () => "docker",
  },
  "publish-artifacts": {
    label: "Publish",
    toolFn: (prefs) => prefs.containerRegistry ?? "registry",
  },
  deploy: {
    label: "Deploy",
    toolFn: (prefs) => {
      if (prefs.deployTarget === "docker-compose") return "compose";
      if (prefs.deployTarget === "helm") return "helm";
      if (prefs.deployTarget === "argocd") return "argocd";
      if (prefs.deployTarget === "bare-metal") return "ssh";
      if (prefs.deployTarget === "serverless") return "lambda";
      if (prefs.deployTarget === "ecs") return "ecs";
      return "k8s";
    },
  },
};

// ── Parallel stage groups ────────────────────────────────────────────

/** Stages that can run in parallel after build completes. */
export const PARALLEL_STAGES: PipelineStage[] = ["test", "lint", "security-scan"];

/** Ordered columns for the pipeline diagram. Each column holds stages that run together. */
export function buildPipelineColumns(stages: PipelineStage[]): PipelineStage[][] {
  const columns: PipelineStage[][] = [];

  // Column 0: build (always first if selected)
  if (stages.includes("build")) columns.push(["build"]);

  // Column 1: parallel group (test, lint, security-scan)
  const parallel = PARALLEL_STAGES.filter((s) => stages.includes(s));
  if (parallel.length > 0) columns.push(parallel);

  // Column 2: containerize
  if (stages.includes("containerize")) columns.push(["containerize"]);

  // Column 3: publish-artifacts
  if (stages.includes("publish-artifacts")) columns.push(["publish-artifacts"]);

  // Column 4: deploy
  if (stages.includes("deploy")) columns.push(["deploy"]);

  return columns;
}
