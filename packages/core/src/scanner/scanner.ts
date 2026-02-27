import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";
import { LLMInsightsSchema } from "./types";
import type {
  LanguageDetection,
  PackageManager,
  CIDetection,
  ContainerDetection,
  InfraDetection,
  MonitoringDetection,
  ScriptsDetection,
  SecurityDetection,
  Metadata,
  RepoContext,
  LLMInsights,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────────

/** List immediate child directories (skips dotfiles and node_modules). */
function listChildDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.isSymbolicLink() &&
          !d.name.startsWith(".") &&
          d.name !== "node_modules",
      )
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Match a file indicator against a directory. Supports glob patterns like "*.ext".
 * Returns the matched filename or null.
 */
function matchFileIndicator(dir: string, indicator: string): string | null {
  if (indicator.startsWith("*")) {
    // Glob pattern: match any file with the given extension
    const ext = indicator.slice(1); // e.g. ".csproj"
    try {
      const entries = fs.readdirSync(dir);
      const match = entries.find((f) => f.endsWith(ext));
      return match ?? null;
    } catch {
      return null;
    }
  }
  // Exact match
  return fs.existsSync(path.join(dir, indicator)) ? indicator : null;
}

// ── Language detection ───────────────────────────────────────────────

const LANGUAGE_INDICATORS: Array<{
  name: string;
  files: string[];
  confidence: number;
}> = [
  { name: "node", files: ["package.json"], confidence: 0.9 },
  { name: "typescript", files: ["tsconfig.json"], confidence: 0.85 },
  {
    name: "python",
    files: ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg"],
    confidence: 0.9,
  },
  { name: "go", files: ["go.mod"], confidence: 0.95 },
  { name: "rust", files: ["Cargo.toml"], confidence: 0.95 },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"], confidence: 0.9 },
  { name: "ruby", files: ["Gemfile"], confidence: 0.9 },
  { name: "php", files: ["composer.json"], confidence: 0.9 },
  { name: "dotnet", files: ["*.csproj", "*.sln", "global.json"], confidence: 0.9 },
  { name: "elixir", files: ["mix.exs"], confidence: 0.95 },
  { name: "dart", files: ["pubspec.yaml"], confidence: 0.95 },
  { name: "swift", files: ["Package.swift"], confidence: 0.95 },
  { name: "c-cpp", files: ["CMakeLists.txt", "meson.build", "configure.ac"], confidence: 0.85 },
  { name: "scala", files: ["build.sbt"], confidence: 0.9 },
  { name: "haskell", files: ["stack.yaml", "*.cabal"], confidence: 0.9 },
  { name: "zig", files: ["build.zig"], confidence: 0.95 },
];

/**
 * Detect languages at root and in immediate child directories.
 * Returns one entry per (language, indicator path) pair.
 */
export function detectLanguages(root: string): LanguageDetection[] {
  const results: LanguageDetection[] = [];
  const seen = new Set<string>(); // track "lang:dir" to avoid duplicates

  const searchDirs = ["", ...listChildDirs(root)];
  for (const dir of searchDirs) {
    const absDir = dir ? path.join(root, dir) : root;
    for (const lang of LANGUAGE_INDICATORS) {
      const key = `${lang.name}:${dir}`;
      if (seen.has(key)) continue;
      for (const file of lang.files) {
        const matched = matchFileIndicator(absDir, file);
        if (matched) {
          const indicator = dir ? `${dir}/${matched}` : matched;
          // Subdirectory detections get slightly lower confidence
          const confidence = dir ? lang.confidence * 0.9 : lang.confidence;
          results.push({ name: lang.name, confidence, indicator });
          seen.add(key);
          break;
        }
      }
    }
  }
  return results;
}

// ── Package manager detection ────────────────────────────────────────

const PACKAGE_MANAGERS: Array<{
  name: string;
  lockfile: string;
}> = [
  { name: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "yarn", lockfile: "yarn.lock" },
  { name: "npm", lockfile: "package-lock.json" },
  { name: "bun", lockfile: "bun.lockb" },
  { name: "poetry", lockfile: "poetry.lock" },
  { name: "cargo", lockfile: "Cargo.lock" },
  { name: "go", lockfile: "go.sum" },
  { name: "bundler", lockfile: "Gemfile.lock" },
  { name: "pip", lockfile: "requirements.txt" },
];

/**
 * Detect package manager at root, falling back to immediate child dirs.
 * Root-level lockfile takes priority.
 */
export function detectPackageManager(root: string): PackageManager | null {
  // Check root first
  for (const pm of PACKAGE_MANAGERS) {
    if (fs.existsSync(path.join(root, pm.lockfile))) {
      return { name: pm.name, lockfile: pm.lockfile };
    }
  }
  // Check child directories
  for (const dir of listChildDirs(root)) {
    for (const pm of PACKAGE_MANAGERS) {
      if (fs.existsSync(path.join(root, dir, pm.lockfile))) {
        return { name: pm.name, lockfile: `${dir}/${pm.lockfile}` };
      }
    }
  }
  return null;
}

// ── CI detection ─────────────────────────────────────────────────────

export function detectCI(root: string): CIDetection[] {
  const results: CIDetection[] = [];

  // GitHub Actions
  const workflowsDir = path.join(root, ".github", "workflows");
  if (fs.existsSync(workflowsDir)) {
    try {
      const files = fs
        .readdirSync(workflowsDir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
      for (const file of files) {
        results.push({
          platform: "github-actions",
          configPath: `.github/workflows/${file}`,
        });
        // Reusable workflows — check for workflow_call trigger
        try {
          const content = fs.readFileSync(path.join(workflowsDir, file), "utf-8");
          if (/workflow_call/.test(content)) {
            results.push({
              platform: "github-reusable-workflow",
              configPath: `.github/workflows/${file}`,
            });
          }
        } catch {
          /* unreadable */
        }
      }
    } catch {
      // Permission denied or other read error
    }
  }

  // GitHub Composite Actions
  const actionsDir = path.join(root, ".github", "actions");
  if (fs.existsSync(actionsDir)) {
    try {
      const dirs = fs
        .readdirSync(actionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const dir of dirs) {
        for (const f of ["action.yml", "action.yaml"]) {
          if (fs.existsSync(path.join(actionsDir, dir.name, f))) {
            results.push({
              platform: "github-composite-action",
              configPath: `.github/actions/${dir.name}/${f}`,
            });
            break;
          }
        }
      }
    } catch {
      // Permission denied or other read error
    }
  }

  // GitLab CI
  if (fs.existsSync(path.join(root, ".gitlab-ci.yml"))) {
    results.push({ platform: "gitlab-ci", configPath: ".gitlab-ci.yml" });
  }

  // Jenkins
  if (fs.existsSync(path.join(root, "Jenkinsfile"))) {
    results.push({ platform: "jenkins", configPath: "Jenkinsfile" });
  }

  // CircleCI
  if (fs.existsSync(path.join(root, ".circleci", "config.yml"))) {
    results.push({ platform: "circleci", configPath: ".circleci/config.yml" });
  }

  // Azure Pipelines
  for (const f of ["azure-pipelines.yml", "azure-pipelines.yaml"]) {
    if (fs.existsSync(path.join(root, f))) {
      results.push({ platform: "azure-pipelines", configPath: f });
      break;
    }
  }

  // AWS CodeBuild
  for (const f of ["buildspec.yml", "buildspec.yaml"]) {
    if (fs.existsSync(path.join(root, f))) {
      results.push({ platform: "aws-codebuild", configPath: f });
      break;
    }
  }

  // Bitbucket Pipelines
  if (fs.existsSync(path.join(root, "bitbucket-pipelines.yml"))) {
    results.push({ platform: "bitbucket-pipelines", configPath: "bitbucket-pipelines.yml" });
  }

  // Drone CI
  if (fs.existsSync(path.join(root, ".drone.yml"))) {
    results.push({ platform: "drone", configPath: ".drone.yml" });
  }

  // Travis CI
  if (fs.existsSync(path.join(root, ".travis.yml"))) {
    results.push({ platform: "travis-ci", configPath: ".travis.yml" });
  }

  // Tekton
  if (fs.existsSync(path.join(root, ".tekton"))) {
    results.push({ platform: "tekton", configPath: ".tekton/" });
  }

  // Woodpecker CI
  if (fs.existsSync(path.join(root, ".woodpecker.yml"))) {
    results.push({ platform: "woodpecker", configPath: ".woodpecker.yml" });
  } else if (fs.existsSync(path.join(root, ".woodpecker"))) {
    results.push({ platform: "woodpecker", configPath: ".woodpecker/" });
  }

  // Concourse CI
  if (fs.existsSync(path.join(root, ".concourse"))) {
    results.push({ platform: "concourse", configPath: ".concourse/" });
  }

  // TeamCity
  if (fs.existsSync(path.join(root, ".teamcity"))) {
    results.push({ platform: "teamcity", configPath: ".teamcity/" });
  }

  return results;
}

// ── Container detection ──────────────────────────────────────────────

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

/**
 * Detect Dockerfiles and Compose files at root and in child directories.
 */
export function detectContainer(root: string): ContainerDetection {
  // Dockerfiles — check root + children
  let hasDockerfile = fs.existsSync(path.join(root, "Dockerfile"));
  if (!hasDockerfile) {
    hasDockerfile = listChildDirs(root).some((d) =>
      fs.existsSync(path.join(root, d, "Dockerfile")),
    );
  }

  // Compose files — root only (compose typically lives at project root)
  let hasCompose = false;
  let composePath: string | undefined;
  for (const f of COMPOSE_FILES) {
    if (fs.existsSync(path.join(root, f))) {
      hasCompose = true;
      composePath = f;
      break;
    }
  }

  // Docker Swarm
  let hasSwarm = false;
  for (const f of ["docker-stack.yml", "docker-stack.yaml"]) {
    if (fs.existsSync(path.join(root, f))) {
      hasSwarm = true;
      break;
    }
  }
  if (!hasSwarm && composePath) {
    try {
      const content = fs.readFileSync(path.join(root, composePath), "utf-8");
      hasSwarm = /deploy:\s*\n\s+(mode:|placement:|replicas:)/m.test(content);
    } catch {
      /* unreadable */
    }
  }

  return { hasDockerfile, hasCompose, ...(composePath ? { composePath } : {}), hasSwarm };
}

// ── Infrastructure detection ─────────────────────────────────────────

const TF_PROVIDER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /provider\s+"aws"/, name: "aws" },
  { pattern: /provider\s+"google"/, name: "gcp" },
  { pattern: /provider\s+"azurerm"/, name: "azure" },
  { pattern: /provider\s+"vultr"/, name: "vultr" },
  { pattern: /provider\s+"digitalocean"/, name: "digitalocean" },
  { pattern: /provider\s+"hcloud"/, name: "hetzner" },
  { pattern: /provider\s+"linode"/, name: "linode" },
  { pattern: /provider\s+"cloudflare"/, name: "cloudflare" },
  { pattern: /provider\s+"oci"/, name: "oracle" },
  { pattern: /provider\s+"alicloud"/, name: "alibaba" },
  { pattern: /provider\s+"kubernetes"/, name: "kubernetes" },
  { pattern: /provider\s+"helm"/, name: "helm" },
  { pattern: /provider\s+"docker"/, name: "docker" },
  { pattern: /provider\s+"github"/, name: "github" },
  { pattern: /provider\s+"gitlab"/, name: "gitlab" },
  { pattern: /provider\s+"datadog"/, name: "datadog" },
  { pattern: /provider\s+"grafana"/, name: "grafana" },
  { pattern: /provider\s+"vault"/, name: "vault" },
  { pattern: /provider\s+"consul"/, name: "consul" },
];

/** Directories whose mere existence strongly suggests Kubernetes manifests. */
const K8S_STRONG_DIRS = ["k8s", "kubernetes"];
/** Directories that need content verification to confirm Kubernetes usage. */
const K8S_WEAK_DIRS = ["manifests", "deploy"];

const K8S_CONTENT_PATTERN = /apiVersion:|kind:\s/;

const ANSIBLE_INDICATORS = ["playbook.yml", "playbook.yaml", "ansible.cfg", "roles"];

/**
 * Check if a directory contains files that look like Kubernetes manifests.
 * Reads up to 5 YAML files and checks for apiVersion/kind patterns.
 */
function dirContainsK8sManifests(dirPath: string): boolean {
  try {
    const entries = fs.readdirSync(dirPath);
    const yamlFiles = entries.filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).slice(0, 5);
    for (const file of yamlFiles) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
        if (K8S_CONTENT_PATTERN.test(content)) return true;
      } catch {
        // Unreadable file
      }
    }
  } catch {
    // Unreadable dir
  }
  return false;
}

/** Scan a directory for .tf files and extract provider names. */
function scanTfDir(dir: string, tfProviders: string[]): boolean {
  try {
    const entries = fs.readdirSync(dir);
    const tfFiles = entries.filter((f) => f.endsWith(".tf"));
    if (tfFiles.length === 0) return false;
    for (const tf of tfFiles) {
      try {
        const content = fs.readFileSync(path.join(dir, tf), "utf-8");
        const uncommented = content
          .split("\n")
          .filter((l) => !l.trimStart().startsWith("#") && !l.trimStart().startsWith("//"))
          .join("\n");
        for (const { pattern, name } of TF_PROVIDER_PATTERNS) {
          if (pattern.test(uncommented) && !tfProviders.includes(name)) {
            tfProviders.push(name);
          }
        }
      } catch {
        // Unreadable file
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function detectInfra(root: string): InfraDetection {
  // Terraform
  let hasState = false;
  const tfProviders: string[] = [];

  let hasTerraform = scanTfDir(root, tfProviders);

  try {
    const entries = fs.readdirSync(root);
    hasState = entries.some((f) => f === "terraform.tfstate" || f === ".terraform");
  } catch {
    // Root unreadable
  }

  // Fallback: scan common subdirectories for .tf files
  if (!hasTerraform) {
    for (const child of listChildDirs(root)) {
      const childPath = path.join(root, child);
      if (scanTfDir(childPath, tfProviders)) {
        hasTerraform = true;
        break;
      }
    }
  }

  // Kubernetes — strong dirs always count, weak dirs need content verification
  let hasKubernetes = K8S_STRONG_DIRS.some((d) => fs.existsSync(path.join(root, d)));
  if (!hasKubernetes) {
    hasKubernetes = K8S_WEAK_DIRS.some((d) => {
      const dirPath = path.join(root, d);
      return fs.existsSync(dirPath) && dirContainsK8sManifests(dirPath);
    });
  }

  // Helm — check root, then subdirectories
  let hasHelm =
    fs.existsSync(path.join(root, "Chart.yaml")) || fs.existsSync(path.join(root, "charts"));
  if (!hasHelm) {
    hasHelm = listChildDirs(root).some(
      (d) =>
        fs.existsSync(path.join(root, d, "Chart.yaml")) ||
        fs.existsSync(path.join(root, d, "charts")),
    );
  }

  // Ansible — check root, then subdirectories
  let hasAnsible = ANSIBLE_INDICATORS.some((f) => fs.existsSync(path.join(root, f)));
  if (!hasAnsible) {
    hasAnsible = listChildDirs(root).some((d) =>
      ANSIBLE_INDICATORS.some((f) => fs.existsSync(path.join(root, d, f))),
    );
  }

  // Kustomize — check root, then subdirectories
  let hasKustomize =
    fs.existsSync(path.join(root, "kustomization.yaml")) ||
    fs.existsSync(path.join(root, "kustomization.yml"));
  if (!hasKustomize) {
    hasKustomize = listChildDirs(root).some(
      (d) =>
        fs.existsSync(path.join(root, d, "kustomization.yaml")) ||
        fs.existsSync(path.join(root, d, "kustomization.yml")),
    );
  }

  // Vagrant
  const hasVagrant = fs.existsSync(path.join(root, "Vagrantfile"));

  // Pulumi
  const hasPulumi =
    fs.existsSync(path.join(root, "Pulumi.yaml")) || fs.existsSync(path.join(root, "Pulumi.yml"));

  // CloudFormation
  let hasCloudFormation = fs.existsSync(path.join(root, "cloudformation"));
  if (!hasCloudFormation) {
    try {
      const entries = fs.readdirSync(root);
      hasCloudFormation = entries.some((f) => f.endsWith(".cfn.yml") || f.endsWith(".cfn.yaml"));
    } catch {
      // Root unreadable
    }
  }
  if (!hasCloudFormation && fs.existsSync(path.join(root, "template.yaml"))) {
    try {
      const content = fs.readFileSync(path.join(root, "template.yaml"), "utf-8");
      hasCloudFormation = /AWSTemplateFormatVersion/.test(content);
    } catch {
      // Unreadable
    }
  }

  // Packer — check root, then subdirectories
  let hasPacker = false;
  try {
    const entries = fs.readdirSync(root);
    hasPacker =
      entries.some((f) => f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json")) ||
      entries.includes("packer.json");
  } catch {
    /* unreadable */
  }
  if (!hasPacker) {
    hasPacker = listChildDirs(root).some((d) => {
      try {
        const entries = fs.readdirSync(path.join(root, d));
        return (
          entries.some((f) => f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json")) ||
          entries.includes("packer.json")
        );
      } catch {
        return false;
      }
    });
  }

  // CDK — check root, then subdirectories
  let hasCdk = fs.existsSync(path.join(root, "cdk.json"));
  if (!hasCdk) {
    hasCdk = listChildDirs(root).some((d) => fs.existsSync(path.join(root, d, "cdk.json")));
  }

  // Skaffold — check root, then subdirectories
  let hasSkaffold = fs.existsSync(path.join(root, "skaffold.yaml"));
  if (!hasSkaffold) {
    hasSkaffold = listChildDirs(root).some((d) =>
      fs.existsSync(path.join(root, d, "skaffold.yaml")),
    );
  }

  // ArgoCD — check .argocd/ directory
  const hasArgoCD = fs.existsSync(path.join(root, ".argocd"));

  // Tiltfile — check root
  const hasTiltfile = fs.existsSync(path.join(root, "Tiltfile"));

  // Helmfile — check root, then subdirectories
  let hasHelmfile =
    fs.existsSync(path.join(root, "helmfile.yaml")) ||
    fs.existsSync(path.join(root, "helmfile.yml"));
  if (!hasHelmfile) {
    hasHelmfile = listChildDirs(root).some(
      (d) =>
        fs.existsSync(path.join(root, d, "helmfile.yaml")) ||
        fs.existsSync(path.join(root, d, "helmfile.yml")),
    );
  }

  return {
    hasTerraform,
    tfProviders,
    hasState,
    hasKubernetes,
    hasHelm,
    hasAnsible,
    hasKustomize,
    hasVagrant,
    hasPulumi,
    hasCloudFormation,
    hasPacker,
    hasCdk,
    hasSkaffold,
    hasArgoCD,
    hasTiltfile,
    hasHelmfile,
  };
}

// ── Monitoring detection ─────────────────────────────────────────────

export function detectMonitoring(root: string): MonitoringDetection {
  let hasPrometheus =
    fs.existsSync(path.join(root, "prometheus.yml")) ||
    fs.existsSync(path.join(root, "prometheus.yaml"));
  if (!hasPrometheus) {
    hasPrometheus = listChildDirs(root).some(
      (d) =>
        fs.existsSync(path.join(root, d, "prometheus.yml")) ||
        fs.existsSync(path.join(root, d, "prometheus.yaml")),
    );
  }

  let hasNginx = fs.existsSync(path.join(root, "nginx.conf"));
  if (!hasNginx) {
    hasNginx = listChildDirs(root).some((d) => fs.existsSync(path.join(root, d, "nginx.conf")));
  }

  let hasSystemd = false;
  try {
    const entries = fs.readdirSync(root);
    hasSystemd = entries.some((f) => f.endsWith(".service"));
  } catch {
    // Root unreadable
  }
  if (!hasSystemd) {
    hasSystemd = listChildDirs(root).some((d) => {
      try {
        return fs.readdirSync(path.join(root, d)).some((f) => f.endsWith(".service"));
      } catch {
        return false;
      }
    });
  }

  const hasHaproxy = fs.existsSync(path.join(root, "haproxy.cfg"));

  const hasTomcat = fs.existsSync(path.join(root, "server.xml"));

  const hasApache =
    fs.existsSync(path.join(root, "httpd.conf")) ||
    fs.existsSync(path.join(root, "apache2.conf")) ||
    fs.existsSync(path.join(root, ".htaccess"));

  const hasCaddy = fs.existsSync(path.join(root, "Caddyfile"));

  const hasEnvoy =
    fs.existsSync(path.join(root, "envoy.yaml")) || fs.existsSync(path.join(root, "envoy.yml"));

  return {
    hasPrometheus,
    hasNginx,
    hasSystemd,
    hasHaproxy,
    hasTomcat,
    hasApache,
    hasCaddy,
    hasEnvoy,
  };
}

// ── Scripts detection ────────────────────────────────────────────────

export function detectScripts(root: string): ScriptsDetection {
  const shellScripts: string[] = [];
  const pythonScripts: string[] = [];

  function scanForScripts(dir: string, prefix: string): void {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry}` : entry;
        if (entry.endsWith(".sh") || entry.endsWith(".bash")) shellScripts.push(relPath);
        if (entry.endsWith(".py")) pythonScripts.push(relPath);
      }
    } catch {
      // Unreadable
    }
  }

  // Scan root for .sh and .py files
  scanForScripts(root, "");

  // Scan scripts/ directory
  const scriptsDir = path.join(root, "scripts");
  if (fs.existsSync(scriptsDir)) {
    scanForScripts(scriptsDir, "scripts");
  }

  // Scan child directories and their scripts/ subdirectories
  for (const child of listChildDirs(root)) {
    if (child === "scripts") continue; // Already scanned above
    const childPath = path.join(root, child);
    scanForScripts(childPath, child);
    const childScripts = path.join(childPath, "scripts");
    if (fs.existsSync(childScripts)) {
      scanForScripts(childScripts, `${child}/scripts`);
    }
  }

  const hasJustfile = fs.existsSync(path.join(root, "Justfile"));

  return { shellScripts, pythonScripts, hasJustfile };
}

// ── Security detection ───────────────────────────────────────────────

export function detectSecurity(root: string): SecurityDetection {
  const hasEnvExample = fs.existsSync(path.join(root, ".env.example"));
  const hasGitignore = fs.existsSync(path.join(root, ".gitignore"));

  const hasCodeowners =
    fs.existsSync(path.join(root, "CODEOWNERS")) ||
    fs.existsSync(path.join(root, ".github", "CODEOWNERS"));

  const hasSecurityPolicy =
    fs.existsSync(path.join(root, "SECURITY.md")) ||
    fs.existsSync(path.join(root, ".github", "SECURITY.md"));

  const hasDependabot = fs.existsSync(path.join(root, ".github", "dependabot.yml"));

  const hasRenovate = fs.existsSync(path.join(root, "renovate.json"));

  const hasSecretScanning = fs.existsSync(path.join(root, ".github", "secret_scanning.yml"));

  const hasEditorConfig = fs.existsSync(path.join(root, ".editorconfig"));

  return {
    hasEnvExample,
    hasGitignore,
    hasCodeowners,
    hasSecurityPolicy,
    hasDependabot,
    hasRenovate,
    hasSecretScanning,
    hasEditorConfig,
  };
}

// ── Metadata detection ───────────────────────────────────────────────

const MONOREPO_INDICATORS = ["pnpm-workspace.yaml", "lerna.json", "nx.json"];

export function detectMetadata(root: string): Metadata {
  const isGitRepo = fs.existsSync(path.join(root, ".git"));

  // Also detect multi-app repos: multiple child dirs with their own package.json/go.mod etc.
  let isMonorepo = MONOREPO_INDICATORS.some((f) => fs.existsSync(path.join(root, f)));
  if (!isMonorepo) {
    const childDirs = listChildDirs(root);
    const CHILD_LANG_FILES = [
      "package.json",
      "go.mod",
      "Cargo.toml",
      "pyproject.toml",
      "pom.xml",
      "Gemfile",
    ];
    const appDirs = childDirs.filter((d) =>
      CHILD_LANG_FILES.some((f) => fs.existsSync(path.join(root, d, f))),
    );
    isMonorepo = appDirs.length >= 2;
  }

  const hasMakefile = fs.existsSync(path.join(root, "Makefile"));
  const hasReadme =
    fs.existsSync(path.join(root, "README.md")) || fs.existsSync(path.join(root, "readme.md"));
  const hasEnvFile = fs.existsSync(path.join(root, ".env"));

  return { isGitRepo, isMonorepo, hasMakefile, hasReadme, hasEnvFile };
}

// ── Domain mapping ───────────────────────────────────────────────────

export function deriveRelevantDomains(
  ci: CIDetection[],
  container: ContainerDetection,
  infra: InfraDetection,
  monitoring: MonitoringDetection,
  scripts?: ScriptsDetection,
  security?: SecurityDetection,
): string[] {
  const domains: string[] = [];

  if (ci.length > 0) domains.push("ci-cd");
  if (ci.some((c) => c.platform === "github-actions")) domains.push("ci-debugging");
  if (container.hasDockerfile || container.hasCompose) domains.push("containerization");
  if (infra.hasTerraform) domains.push("infrastructure");
  if (infra.hasKubernetes || infra.hasHelm) domains.push("container-orchestration");
  if (infra.hasAnsible) domains.push("infrastructure");
  if (infra.tfProviders.length > 0) domains.push("cloud-architecture");
  if (infra.hasKustomize) domains.push("container-orchestration");
  if (infra.hasPulumi || infra.hasCloudFormation) {
    domains.push("infrastructure");
    domains.push("cloud-architecture");
  }
  if (infra.hasPacker) domains.push("infrastructure");
  if (container.hasSwarm) domains.push("container-orchestration");
  if (monitoring.hasPrometheus) domains.push("observability");
  if (monitoring.hasNginx) domains.push("networking");
  if (monitoring.hasSystemd) domains.push("shell-scripting");
  if (monitoring.hasHaproxy || monitoring.hasApache || monitoring.hasCaddy || monitoring.hasEnvoy) {
    domains.push("networking");
  }

  if (scripts) {
    if (scripts.shellScripts.length > 0) domains.push("shell-scripting");
    if (scripts.pythonScripts.length > 0) domains.push("python-scripting");
  }

  if (security) {
    if (security.hasDependabot || security.hasRenovate || security.hasSecurityPolicy) {
      domains.push("security");
    }
  }

  // Deduplicate
  return [...new Set(domains)];
}

// ── Collect DevOps files ─────────────────────────────────────────────

export function collectDevopsFiles(
  ci: CIDetection[],
  container: ContainerDetection,
  infra: InfraDetection,
  monitoring: MonitoringDetection,
  scripts: ScriptsDetection,
  security: SecurityDetection,
  root: string,
): string[] {
  const files = new Set<string>();

  // CI config paths
  for (const c of ci) files.add(c.configPath);

  // Container
  if (container.hasDockerfile) {
    if (fs.existsSync(path.join(root, "Dockerfile"))) files.add("Dockerfile");
    for (const d of listChildDirs(root)) {
      if (fs.existsSync(path.join(root, d, "Dockerfile"))) files.add(`${d}/Dockerfile`);
    }
  }
  if (container.composePath) files.add(container.composePath);

  // Terraform (root + common subdirectories)
  if (infra.hasTerraform) {
    const tfDirs = ["", "terraform", "infra", "infrastructure", "tf", "iac", "terraform-iac"];
    for (const dir of tfDirs) {
      const dirPath = dir ? path.join(root, dir) : root;
      try {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;
        const entries = fs.readdirSync(dirPath);
        for (const f of entries) {
          if (f.endsWith(".tf") || f === "terraform.tfvars" || f === "terraform.tfvars.json") {
            files.add(dir ? `${dir}/${f}` : f);
          }
        }
      } catch {
        // Unreadable
      }
    }
  }

  // Monitoring configs
  if (monitoring.hasPrometheus) {
    if (fs.existsSync(path.join(root, "prometheus.yml"))) files.add("prometheus.yml");
    if (fs.existsSync(path.join(root, "prometheus.yaml"))) files.add("prometheus.yaml");
  }
  if (monitoring.hasNginx) files.add("nginx.conf");
  if (monitoring.hasHaproxy) files.add("haproxy.cfg");
  if (monitoring.hasTomcat) files.add("server.xml");
  if (monitoring.hasApache) {
    if (fs.existsSync(path.join(root, "httpd.conf"))) files.add("httpd.conf");
    if (fs.existsSync(path.join(root, "apache2.conf"))) files.add("apache2.conf");
    if (fs.existsSync(path.join(root, ".htaccess"))) files.add(".htaccess");
  }
  if (monitoring.hasCaddy) files.add("Caddyfile");
  if (monitoring.hasEnvoy) {
    if (fs.existsSync(path.join(root, "envoy.yaml"))) files.add("envoy.yaml");
    if (fs.existsSync(path.join(root, "envoy.yml"))) files.add("envoy.yml");
  }

  // Systemd services
  try {
    const entries = fs.readdirSync(root);
    for (const f of entries) {
      if (f.endsWith(".service")) files.add(f);
    }
  } catch {
    // Unreadable
  }

  // Scripts
  for (const s of scripts.shellScripts) files.add(s);
  for (const s of scripts.pythonScripts) files.add(s);
  if (scripts.hasJustfile) files.add("Justfile");

  // Security files
  if (security.hasEnvExample) files.add(".env.example");
  if (security.hasGitignore) files.add(".gitignore");
  if (security.hasCodeowners) {
    if (fs.existsSync(path.join(root, "CODEOWNERS"))) files.add("CODEOWNERS");
    if (fs.existsSync(path.join(root, ".github", "CODEOWNERS"))) files.add(".github/CODEOWNERS");
  }
  if (security.hasSecurityPolicy) {
    if (fs.existsSync(path.join(root, "SECURITY.md"))) files.add("SECURITY.md");
    if (fs.existsSync(path.join(root, ".github", "SECURITY.md"))) files.add(".github/SECURITY.md");
  }
  if (security.hasDependabot) files.add(".github/dependabot.yml");
  if (security.hasRenovate) files.add("renovate.json");
  if (security.hasSecretScanning) files.add(".github/secret_scanning.yml");
  if (security.hasEditorConfig) files.add(".editorconfig");

  // Kubernetes manifests
  if (infra.hasKubernetes) {
    const k8sDirs = ["k8s", "kubernetes", "manifests", "deploy"];
    for (const d of k8sDirs) {
      const dirPath = path.join(root, d);
      try {
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const entries = fs.readdirSync(dirPath);
          for (const f of entries) {
            if (f.endsWith(".yaml") || f.endsWith(".yml")) {
              files.add(`${d}/${f}`);
            }
          }
        }
      } catch {
        // Unreadable
      }
    }
  }

  // Infra extras
  if (infra.hasKustomize) {
    if (fs.existsSync(path.join(root, "kustomization.yaml"))) files.add("kustomization.yaml");
    if (fs.existsSync(path.join(root, "kustomization.yml"))) files.add("kustomization.yml");
  }
  if (infra.hasVagrant) files.add("Vagrantfile");
  if (infra.hasPulumi) {
    if (fs.existsSync(path.join(root, "Pulumi.yaml"))) files.add("Pulumi.yaml");
    if (fs.existsSync(path.join(root, "Pulumi.yml"))) files.add("Pulumi.yml");
  }
  if (infra.hasHelm && fs.existsSync(path.join(root, "Chart.yaml"))) files.add("Chart.yaml");
  if (infra.hasAnsible) {
    for (const f of ANSIBLE_INDICATORS) {
      if (fs.existsSync(path.join(root, f))) files.add(f);
    }
  }
  if (infra.hasPacker) {
    try {
      const entries = fs.readdirSync(root);
      for (const f of entries) {
        if (f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json") || f === "packer.json") {
          files.add(f);
        }
      }
    } catch {
      // Unreadable
    }
  }

  // Docker Swarm
  if (container.hasSwarm) {
    for (const f of ["docker-stack.yml", "docker-stack.yaml"]) {
      if (fs.existsSync(path.join(root, f))) files.add(f);
    }
  }

  return [...files].sort();
}

// ── Directory tree generator ─────────────────────────────────────────

const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  ".dojops",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
]);

const MAX_TREE_ENTRIES = 200;

/**
 * Walk the filesystem up to `maxDepth` levels deep, producing an
 * indented tree string. Skips noise directories and dotfiles.
 */
export function generateDirectoryTree(root: string, maxDepth = 2): string {
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number): void {
    if (lines.length >= MAX_TREE_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files, alphabetical within each group
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }

      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = isLast ? "    " : "│   ";

      if (entry.isDirectory()) {
        if (NOISE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        lines.push(`${prefix}${connector}${entry.name}/`);
        if (depth < maxDepth) {
          walk(path.join(dir, entry.name), `${prefix}${childPrefix}`, depth + 1);
        }
      } else {
        lines.push(`${prefix}${connector}${entry.name}`);
      }
    }
  }

  lines.push(`${path.basename(root)}/`);
  walk(root, "", 1);
  return lines.join("\n");
}

// ── LLM enrichment ──────────────────────────────────────────────────

/**
 * Send scan results + directory tree to an LLM provider for richer
 * project insights. Returns structured `LLMInsights`.
 */
export async function enrichWithLLM(
  repoContext: RepoContext,
  provider: LLMProvider,
): Promise<LLMInsights> {
  const tree = generateDirectoryTree(repoContext.rootPath);

  // Strip rootPath for privacy
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rootPath: _rootPath, ...contextForLLM } = repoContext;

  const system = [
    "You are a DevOps project analyzer.",
    "Given a repository scan result and directory tree, produce structured insights about the project.",
    "Focus on actionable DojOps CLI commands the user can run next.",
    "For recommendedAgents, use DojOps specialist agent names: ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python.",
  ].join(" ");

  const prompt = [
    "Analyze this repository and provide insights.\n",
    "## Scan Results\n```json",
    JSON.stringify(contextForLLM, null, 2),
    "```\n",
    "## Directory Tree\n```",
    tree,
    "```",
  ].join("\n");

  const response = await provider.generate({
    system,
    prompt,
    schema: LLMInsightsSchema,
  });

  if (response.parsed) {
    return response.parsed as LLMInsights;
  }

  return parseAndValidate(response.content, LLMInsightsSchema);
}

// ── Main scan orchestrator ───────────────────────────────────────────

export function scanRepo(root: string): RepoContext {
  const languages = detectLanguages(root);
  const packageManager = detectPackageManager(root);
  const ci = detectCI(root);
  const container = detectContainer(root);
  const infra = detectInfra(root);
  const monitoring = detectMonitoring(root);
  const scripts = detectScripts(root);
  const security = detectSecurity(root);
  const meta = detectMetadata(root);
  const relevantDomains = deriveRelevantDomains(
    ci,
    container,
    infra,
    monitoring,
    scripts,
    security,
  );
  const devopsFiles = collectDevopsFiles(ci, container, infra, monitoring, scripts, security, root);

  const primaryLanguage =
    languages.length > 0
      ? languages.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).name
      : null;

  return {
    version: 2,
    scannedAt: new Date().toISOString(),
    rootPath: root,
    languages,
    primaryLanguage,
    packageManager,
    ci,
    container,
    infra,
    monitoring,
    scripts,
    security,
    meta,
    relevantDomains,
    devopsFiles,
  };
}
