import fs from "node:fs";
import path from "node:path";
import type { LLMProvider } from "../llm/provider";
import { LLMInsightsSchema } from "./types";
import type {
  LanguageDetection,
  PackageManager,
  CIDetection,
  ContainerDetection,
  InfraDetection,
  MonitoringDetection,
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
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ── Language detection ───────────────────────────────────────────────

const LANGUAGE_INDICATORS: Array<{
  name: string;
  files: string[];
  confidence: number;
}> = [
  { name: "node", files: ["package.json"], confidence: 0.9 },
  {
    name: "python",
    files: ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg"],
    confidence: 0.9,
  },
  { name: "go", files: ["go.mod"], confidence: 0.95 },
  { name: "rust", files: ["Cargo.toml"], confidence: 0.95 },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"], confidence: 0.9 },
  { name: "ruby", files: ["Gemfile"], confidence: 0.9 },
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
        if (fs.existsSync(path.join(absDir, file))) {
          const indicator = dir ? `${dir}/${file}` : file;
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

  return { hasDockerfile, hasCompose, ...(composePath ? { composePath } : {}) };
}

// ── Infrastructure detection ─────────────────────────────────────────

const TF_PROVIDER_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /provider\s+"aws"/, name: "aws" },
  { pattern: /provider\s+"google"/, name: "gcp" },
  { pattern: /provider\s+"azurerm"/, name: "azure" },
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

export function detectInfra(root: string): InfraDetection {
  // Terraform
  let hasTerraform = false;
  let hasState = false;
  const tfProviders: string[] = [];

  try {
    const entries = fs.readdirSync(root);
    const tfFiles = entries.filter((f) => f.endsWith(".tf"));
    hasTerraform = tfFiles.length > 0;

    if (hasTerraform) {
      for (const tf of tfFiles) {
        try {
          const content = fs.readFileSync(path.join(root, tf), "utf-8");
          for (const { pattern, name } of TF_PROVIDER_PATTERNS) {
            if (pattern.test(content) && !tfProviders.includes(name)) {
              tfProviders.push(name);
            }
          }
        } catch {
          // Unreadable file
        }
      }
    }

    hasState = entries.some((f) => f === "terraform.tfstate" || f === ".terraform");
  } catch {
    // Root unreadable
  }

  // Kubernetes — strong dirs always count, weak dirs need content verification
  let hasKubernetes = K8S_STRONG_DIRS.some((d) => fs.existsSync(path.join(root, d)));
  if (!hasKubernetes) {
    hasKubernetes = K8S_WEAK_DIRS.some((d) => {
      const dirPath = path.join(root, d);
      return fs.existsSync(dirPath) && dirContainsK8sManifests(dirPath);
    });
  }

  // Helm
  const hasHelm =
    fs.existsSync(path.join(root, "Chart.yaml")) || fs.existsSync(path.join(root, "charts"));

  // Ansible
  const hasAnsible = ANSIBLE_INDICATORS.some((f) => fs.existsSync(path.join(root, f)));

  return { hasTerraform, tfProviders, hasState, hasKubernetes, hasHelm, hasAnsible };
}

// ── Monitoring detection ─────────────────────────────────────────────

export function detectMonitoring(root: string): MonitoringDetection {
  const hasPrometheus =
    fs.existsSync(path.join(root, "prometheus.yml")) ||
    fs.existsSync(path.join(root, "prometheus.yaml"));

  const hasNginx = fs.existsSync(path.join(root, "nginx.conf"));

  let hasSystemd = false;
  try {
    const entries = fs.readdirSync(root);
    hasSystemd = entries.some((f) => f.endsWith(".service"));
  } catch {
    // Root unreadable
  }

  return { hasPrometheus, hasNginx, hasSystemd };
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
): string[] {
  const domains: string[] = [];

  if (ci.length > 0) domains.push("ci-cd");
  if (ci.some((c) => c.platform === "github-actions")) domains.push("ci-debugging");
  if (container.hasDockerfile || container.hasCompose) domains.push("containerization");
  if (infra.hasTerraform) domains.push("infrastructure");
  if (infra.hasKubernetes || infra.hasHelm) domains.push("container-orchestration");
  if (infra.hasAnsible) domains.push("infrastructure");
  if (infra.tfProviders.length > 0) domains.push("cloud-architecture");
  if (monitoring.hasPrometheus) domains.push("observability");
  if (monitoring.hasNginx) domains.push("networking");
  if (monitoring.hasSystemd) domains.push("shell-scripting");

  // Deduplicate
  return [...new Set(domains)];
}

// ── Directory tree generator ─────────────────────────────────────────

const NOISE_DIRS = new Set([
  "node_modules",
  ".git",
  ".oda",
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
    "Focus on actionable ODA CLI commands the user can run next.",
    "For recommendedAgents, use ODA specialist agent names: ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python.",
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

  return response.parsed as LLMInsights;
}

// ── Main scan orchestrator ───────────────────────────────────────────

export function scanRepo(root: string): RepoContext {
  const languages = detectLanguages(root);
  const packageManager = detectPackageManager(root);
  const ci = detectCI(root);
  const container = detectContainer(root);
  const infra = detectInfra(root);
  const monitoring = detectMonitoring(root);
  const meta = detectMetadata(root);
  const relevantDomains = deriveRelevantDomains(ci, container, infra, monitoring);

  const primaryLanguage =
    languages.length > 0
      ? languages.reduce((a, b) => (a.confidence >= b.confidence ? a : b)).name
      : null;

  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    rootPath: root,
    languages,
    primaryLanguage,
    packageManager,
    ci,
    container,
    infra,
    monitoring,
    meta,
    relevantDomains,
  };
}
