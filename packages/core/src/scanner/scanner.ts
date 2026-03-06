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
/** Try to match any file indicator for a single language in a directory. */
function matchLanguageInDir(
  lang: { name: string; files: string[]; confidence: number },
  absDir: string,
  dir: string,
): LanguageDetection | null {
  for (const file of lang.files) {
    const matched = matchFileIndicator(absDir, file);
    if (!matched) continue;
    const indicator = dir ? `${dir}/${matched}` : matched;
    const confidence = dir ? lang.confidence * 0.9 : lang.confidence;
    return { name: lang.name, confidence, indicator };
  }
  return null;
}

/** Check a single directory for language indicators and append results. */
function detectLanguagesInDir(
  dir: string,
  root: string,
  seen: Set<string>,
  results: LanguageDetection[],
): void {
  const absDir = dir ? path.join(root, dir) : root;
  for (const lang of LANGUAGE_INDICATORS) {
    const key = `${lang.name}:${dir}`;
    if (seen.has(key)) continue;
    const detection = matchLanguageInDir(lang, absDir, dir);
    if (detection) {
      results.push(detection);
      seen.add(key);
    }
  }
}

export function detectLanguages(root: string): LanguageDetection[] {
  const results: LanguageDetection[] = [];
  const seen = new Set<string>();

  const searchDirs = ["", ...listChildDirs(root)];
  for (const dir of searchDirs) {
    detectLanguagesInDir(dir, root, seen, results);
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

/** Detect GitHub Actions workflows and reusable workflows. */
function detectGitHubActions(root: string, results: CIDetection[]): void {
  const workflowsDir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) return;
  try {
    const files = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    for (const file of files) {
      results.push({ platform: "github-actions", configPath: `.github/workflows/${file}` });
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

/** Detect GitHub Composite Actions. */
function detectGitHubCompositeActions(root: string, results: CIDetection[]): void {
  const actionsDir = path.join(root, ".github", "actions");
  if (!fs.existsSync(actionsDir)) return;
  try {
    const dirs = fs.readdirSync(actionsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
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

/** Detect simple file-based CI platforms. */
function detectSimpleCIPlatforms(root: string, results: CIDetection[]): void {
  const simpleChecks: Array<{ platform: string; file: string; isDir?: boolean }> = [
    { platform: "gitlab-ci", file: ".gitlab-ci.yml" },
    { platform: "jenkins", file: "Jenkinsfile" },
    { platform: "bitbucket-pipelines", file: "bitbucket-pipelines.yml" },
    { platform: "drone", file: ".drone.yml" },
    { platform: "travis-ci", file: ".travis.yml" },
    { platform: "tekton", file: ".tekton", isDir: true },
    { platform: "concourse", file: ".concourse", isDir: true },
    { platform: "teamcity", file: ".teamcity", isDir: true },
  ];
  for (const { platform, file, isDir } of simpleChecks) {
    if (fs.existsSync(path.join(root, file))) {
      results.push({ platform, configPath: isDir ? `${file}/` : file });
    }
  }

  if (fs.existsSync(path.join(root, ".circleci", "config.yml"))) {
    results.push({ platform: "circleci", configPath: ".circleci/config.yml" });
  }

  const multiFileChecks: Array<{ platform: string; files: string[] }> = [
    { platform: "azure-pipelines", files: ["azure-pipelines.yml", "azure-pipelines.yaml"] },
    { platform: "aws-codebuild", files: ["buildspec.yml", "buildspec.yaml"] },
  ];
  for (const { platform, files } of multiFileChecks) {
    for (const f of files) {
      if (fs.existsSync(path.join(root, f))) {
        results.push({ platform, configPath: f });
        break;
      }
    }
  }

  // Woodpecker CI (file or directory)
  if (fs.existsSync(path.join(root, ".woodpecker.yml"))) {
    results.push({ platform: "woodpecker", configPath: ".woodpecker.yml" });
  } else if (fs.existsSync(path.join(root, ".woodpecker"))) {
    results.push({ platform: "woodpecker", configPath: ".woodpecker/" });
  }
}

export function detectCI(root: string): CIDetection[] {
  const results: CIDetection[] = [];
  detectGitHubActions(root, results);
  detectGitHubCompositeActions(root, results);
  detectSimpleCIPlatforms(root, results);
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
      hasSwarm = /deploy:\s*\n\s+(mode:|placement:|replicas:)/m.test(content); // NOSONAR
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

/** Check root and child dirs for a file, return true if found in any. */
function existsInRootOrChild(root: string, filenames: string[]): boolean {
  if (filenames.some((f) => fs.existsSync(path.join(root, f)))) return true;
  return listChildDirs(root).some((d) =>
    filenames.some((f) => fs.existsSync(path.join(root, d, f))),
  );
}

function detectTerraform(root: string): {
  hasTerraform: boolean;
  tfProviders: string[];
  hasState: boolean;
} {
  const tfProviders: string[] = [];
  let hasTerraform = scanTfDir(root, tfProviders);
  let hasState = false;

  try {
    const entries = fs.readdirSync(root);
    hasState = entries.some((f) => f === "terraform.tfstate" || f === ".terraform");
  } catch {
    /* root unreadable */
  }

  if (!hasTerraform) {
    for (const child of listChildDirs(root)) {
      if (scanTfDir(path.join(root, child), tfProviders)) {
        hasTerraform = true;
        break;
      }
    }
  }

  return { hasTerraform, tfProviders, hasState };
}

function detectCloudFormation(root: string): boolean {
  if (fs.existsSync(path.join(root, "cloudformation"))) return true;
  try {
    const entries = fs.readdirSync(root);
    if (entries.some((f) => f.endsWith(".cfn.yml") || f.endsWith(".cfn.yaml"))) return true;
  } catch {
    /* root unreadable */
  }
  if (fs.existsSync(path.join(root, "template.yaml"))) {
    try {
      const content = fs.readFileSync(path.join(root, "template.yaml"), "utf-8");
      if (/AWSTemplateFormatVersion/.test(content)) return true;
    } catch {
      /* unreadable */
    }
  }
  return false;
}

function detectPacker(root: string): boolean {
  const hasPkrFiles = (dir: string): boolean => {
    try {
      const entries = fs.readdirSync(dir);
      return (
        entries.some((f) => f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json")) ||
        entries.includes("packer.json")
      );
    } catch {
      return false;
    }
  };
  if (hasPkrFiles(root)) return true;
  return listChildDirs(root).some((d) => hasPkrFiles(path.join(root, d)));
}

function detectKubernetes(root: string): boolean {
  if (K8S_STRONG_DIRS.some((d) => fs.existsSync(path.join(root, d)))) return true;
  return K8S_WEAK_DIRS.some((d) => {
    const dirPath = path.join(root, d);
    return fs.existsSync(dirPath) && dirContainsK8sManifests(dirPath);
  });
}

export function detectInfra(root: string): InfraDetection {
  const { hasTerraform, tfProviders, hasState } = detectTerraform(root);

  return {
    hasTerraform,
    tfProviders,
    hasState,
    hasKubernetes: detectKubernetes(root),
    hasHelm: existsInRootOrChild(root, ["Chart.yaml", "charts"]),
    hasAnsible: existsInRootOrChild(root, ANSIBLE_INDICATORS),
    hasKustomize: existsInRootOrChild(root, ["kustomization.yaml", "kustomization.yml"]),
    hasVagrant: fs.existsSync(path.join(root, "Vagrantfile")),
    hasPulumi: existsInRootOrChild(root, ["Pulumi.yaml", "Pulumi.yml"]),
    hasCloudFormation: detectCloudFormation(root),
    hasPacker: detectPacker(root),
    hasCdk: existsInRootOrChild(root, ["cdk.json"]),
    hasSkaffold: existsInRootOrChild(root, ["skaffold.yaml"]),
    hasArgoCD: fs.existsSync(path.join(root, ".argocd")),
    hasTiltfile: fs.existsSync(path.join(root, "Tiltfile")),
    hasHelmfile: existsInRootOrChild(root, ["helmfile.yaml", "helmfile.yml"]),
  };
}

// ── Monitoring detection ─────────────────────────────────────────────

function detectSystemdInDir(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith(".service"));
  } catch {
    return false;
  }
}

function detectSystemd(root: string): boolean {
  if (detectSystemdInDir(root)) return true;
  return listChildDirs(root).some((d) => detectSystemdInDir(path.join(root, d)));
}

export function detectMonitoring(root: string): MonitoringDetection {
  return {
    hasPrometheus: existsInRootOrChild(root, ["prometheus.yml", "prometheus.yaml"]),
    hasNginx: existsInRootOrChild(root, ["nginx.conf"]),
    hasSystemd: detectSystemd(root),
    hasHaproxy: fs.existsSync(path.join(root, "haproxy.cfg")),
    hasTomcat: fs.existsSync(path.join(root, "server.xml")),
    hasApache: existsInRootOrChild(root, ["httpd.conf", "apache2.conf", ".htaccess"]),
    hasCaddy: fs.existsSync(path.join(root, "Caddyfile")),
    hasEnvoy: existsInRootOrChild(root, ["envoy.yaml", "envoy.yml"]),
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

/** Derive domains from CI detection results. */
function deriveCIDomains(ci: CIDetection[], domains: string[]): void {
  if (ci.length > 0) domains.push("ci-cd");
  if (ci.some((c) => c.platform === "github-actions")) domains.push("ci-debugging");
}

/** Derive domains from container detection results. */
function deriveContainerDomains(container: ContainerDetection, domains: string[]): void {
  if (container.hasDockerfile || container.hasCompose) domains.push("containerization");
  if (container.hasSwarm) domains.push("container-orchestration");
}

/** Derive domains from infrastructure detection results. */
function deriveInfraDomains(infra: InfraDetection, domains: string[]): void {
  if (infra.hasTerraform) domains.push("infrastructure");
  if (infra.hasKubernetes || infra.hasHelm) domains.push("container-orchestration");
  if (infra.hasAnsible) domains.push("infrastructure");
  if (infra.tfProviders.length > 0) domains.push("cloud-architecture");
  if (infra.hasKustomize) domains.push("container-orchestration");
  if (infra.hasPulumi || infra.hasCloudFormation) {
    domains.push("infrastructure", "cloud-architecture");
  }
  if (infra.hasPacker) domains.push("infrastructure");
}

/** Derive domains from monitoring detection results. */
function deriveMonitoringDomains(monitoring: MonitoringDetection, domains: string[]): void {
  if (monitoring.hasPrometheus) domains.push("observability");
  if (monitoring.hasNginx) domains.push("networking");
  if (monitoring.hasSystemd) domains.push("shell-scripting");
  if (monitoring.hasHaproxy || monitoring.hasApache || monitoring.hasCaddy || monitoring.hasEnvoy) {
    domains.push("networking");
  }
}

export function deriveRelevantDomains(
  ci: CIDetection[],
  container: ContainerDetection,
  infra: InfraDetection,
  monitoring: MonitoringDetection,
  scripts?: ScriptsDetection,
  security?: SecurityDetection,
): string[] {
  const domains: string[] = [];

  deriveCIDomains(ci, domains);
  deriveContainerDomains(container, domains);
  deriveInfraDomains(infra, domains);
  deriveMonitoringDomains(monitoring, domains);

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

/** Add files if they exist at root. */
function addExistingFiles(files: Set<string>, root: string, filenames: string[]): void {
  for (const f of filenames) {
    if (fs.existsSync(path.join(root, f))) files.add(f);
  }
}

/** Collect container-related files (Dockerfiles + compose). */
function collectContainerFiles(
  files: Set<string>,
  container: ContainerDetection,
  root: string,
): void {
  if (container.hasDockerfile) {
    if (fs.existsSync(path.join(root, "Dockerfile"))) files.add("Dockerfile");
    for (const d of listChildDirs(root)) {
      if (fs.existsSync(path.join(root, d, "Dockerfile"))) files.add(`${d}/Dockerfile`);
    }
  }
  if (container.composePath) files.add(container.composePath);
  if (container.hasSwarm) {
    addExistingFiles(files, root, ["docker-stack.yml", "docker-stack.yaml"]);
  }
}

/** Check if a filename is a Terraform-related file. */
function isTerraformFile(filename: string): boolean {
  return (
    filename.endsWith(".tf") ||
    filename === "terraform.tfvars" ||
    filename === "terraform.tfvars.json"
  );
}

/** Scan a single directory for Terraform files and add them to the set. */
function collectTfFilesFromDir(files: Set<string>, dirPath: string, prefix: string): void {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;
    const entries = fs.readdirSync(dirPath);
    for (const f of entries) {
      if (isTerraformFile(f)) {
        files.add(prefix ? `${prefix}/${f}` : f);
      }
    }
  } catch {
    // Unreadable
  }
}

/** Collect Terraform .tf and .tfvars files from known directories. */
function collectTerraformFiles(files: Set<string>, root: string): void {
  const tfDirs = ["", "terraform", "infra", "infrastructure", "tf", "iac", "terraform-iac"];
  for (const dir of tfDirs) {
    const dirPath = dir ? path.join(root, dir) : root;
    collectTfFilesFromDir(files, dirPath, dir);
  }
}

/** Collect monitoring config files. */
function collectMonitoringFiles(
  files: Set<string>,
  monitoring: MonitoringDetection,
  root: string,
): void {
  if (monitoring.hasPrometheus)
    addExistingFiles(files, root, ["prometheus.yml", "prometheus.yaml"]);
  if (monitoring.hasNginx) files.add("nginx.conf");
  if (monitoring.hasHaproxy) files.add("haproxy.cfg");
  if (monitoring.hasTomcat) files.add("server.xml");
  if (monitoring.hasApache)
    addExistingFiles(files, root, ["httpd.conf", "apache2.conf", ".htaccess"]);
  if (monitoring.hasCaddy) files.add("Caddyfile");
  if (monitoring.hasEnvoy) addExistingFiles(files, root, ["envoy.yaml", "envoy.yml"]);

  // Systemd services
  try {
    for (const f of fs.readdirSync(root)) {
      if (f.endsWith(".service")) files.add(f);
    }
  } catch {
    // Unreadable
  }
}

/** Collect script files. */
function collectScriptFiles(files: Set<string>, scripts: ScriptsDetection): void {
  for (const s of scripts.shellScripts) files.add(s);
  for (const s of scripts.pythonScripts) files.add(s);
  if (scripts.hasJustfile) files.add("Justfile");
}

/** Collect security-related files. */
function collectSecurityFiles(files: Set<string>, security: SecurityDetection, root: string): void {
  if (security.hasEnvExample) files.add(".env.example");
  if (security.hasGitignore) files.add(".gitignore");
  if (security.hasCodeowners) {
    addExistingFiles(files, root, ["CODEOWNERS"]);
    if (fs.existsSync(path.join(root, ".github", "CODEOWNERS"))) files.add(".github/CODEOWNERS");
  }
  if (security.hasSecurityPolicy) {
    addExistingFiles(files, root, ["SECURITY.md"]);
    if (fs.existsSync(path.join(root, ".github", "SECURITY.md"))) files.add(".github/SECURITY.md");
  }
  if (security.hasDependabot) files.add(".github/dependabot.yml");
  if (security.hasRenovate) files.add("renovate.json");
  if (security.hasSecretScanning) files.add(".github/secret_scanning.yml");
  if (security.hasEditorConfig) files.add(".editorconfig");
}

/** Collect Kubernetes YAML manifests from well-known directories. */
function collectK8sFiles(files: Set<string>, root: string): void {
  const k8sDirs = ["k8s", "kubernetes", "manifests", "deploy"];
  for (const d of k8sDirs) {
    const dirPath = path.join(root, d);
    try {
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;
      for (const f of fs.readdirSync(dirPath)) {
        if (f.endsWith(".yaml") || f.endsWith(".yml")) files.add(`${d}/${f}`);
      }
    } catch {
      // Unreadable
    }
  }
}

/** Collect miscellaneous infra files (Kustomize, Vagrant, Pulumi, Helm, Ansible, Packer). */
function collectInfraExtraFiles(files: Set<string>, infra: InfraDetection, root: string): void {
  if (infra.hasKustomize)
    addExistingFiles(files, root, ["kustomization.yaml", "kustomization.yml"]);
  if (infra.hasVagrant) files.add("Vagrantfile");
  if (infra.hasPulumi) addExistingFiles(files, root, ["Pulumi.yaml", "Pulumi.yml"]);
  if (infra.hasHelm && fs.existsSync(path.join(root, "Chart.yaml"))) files.add("Chart.yaml");
  if (infra.hasAnsible) addExistingFiles(files, root, ANSIBLE_INDICATORS);
  if (infra.hasPacker) {
    try {
      for (const f of fs.readdirSync(root)) {
        if (f.endsWith(".pkr.hcl") || f.endsWith(".pkr.json") || f === "packer.json") {
          files.add(f);
        }
      }
    } catch {
      // Unreadable
    }
  }
}

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

  for (const c of ci) files.add(c.configPath);
  collectContainerFiles(files, container, root);
  if (infra.hasTerraform) collectTerraformFiles(files, root);
  collectMonitoringFiles(files, monitoring, root);
  collectScriptFiles(files, scripts);
  collectSecurityFiles(files, security, root);
  if (infra.hasKubernetes) collectK8sFiles(files, root);
  collectInfraExtraFiles(files, infra, root);

  return [...files].sort((a, b) => a.localeCompare(b));
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

/** Check if a directory entry should be skipped in the tree output. */
function isSkippedDir(entry: fs.Dirent): boolean {
  return NOISE_DIRS.has(entry.name) || entry.name.startsWith(".");
}

/** Sort directory entries: directories first, then files, alphabetical within each group. */
function sortDirEntries(entries: fs.Dirent[]): void {
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Read and sort directory entries. Returns empty array on failure. */
function readSortedEntries(dir: string): fs.Dirent[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    sortDirEntries(entries);
    return entries;
  } catch {
    return [];
  }
}

interface TreeEntryContext {
  dir: string;
  prefix: string;
  connector: string;
  childPrefix: string;
  depth: number;
  maxDepth: number;
  lines: string[];
}

/** Process a single directory entry and add it to the tree lines. */
function processTreeEntry(entry: fs.Dirent, ctx: TreeEntryContext): void {
  if (entry.isDirectory()) {
    if (isSkippedDir(entry)) return;
    ctx.lines.push(`${ctx.prefix}${ctx.connector}${entry.name}/`);
    if (ctx.depth < ctx.maxDepth) {
      walkTree(
        path.join(ctx.dir, entry.name),
        `${ctx.prefix}${ctx.childPrefix}`,
        ctx.depth + 1,
        ctx.maxDepth,
        ctx.lines,
      );
    }
  } else {
    ctx.lines.push(`${ctx.prefix}${ctx.connector}${entry.name}`);
  }
}

/** Recursively walk a directory tree, appending indented lines. */
function walkTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): void {
  if (lines.length >= MAX_TREE_ENTRIES) return;
  const entries = readSortedEntries(dir);

  for (let i = 0; i < entries.length; i++) {
    if (lines.length >= MAX_TREE_ENTRIES) {
      lines.push(`${prefix}... (truncated)`);
      return;
    }
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    processTreeEntry(entries[i], { dir, prefix, connector, childPrefix, depth, maxDepth, lines });
  }
}

/**
 * Walk the filesystem up to `maxDepth` levels deep, producing an
 * indented tree string. Skips noise directories and dotfiles.
 */
export function generateDirectoryTree(root: string, maxDepth = 2): string {
  const lines: string[] = [];
  lines.push(`${path.basename(root)}/`);
  walkTree(root, "", 1, maxDepth, lines);
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
      ? languages.reduce((a, b) => (a.confidence >= b.confidence ? a : b), languages[0]).name
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
