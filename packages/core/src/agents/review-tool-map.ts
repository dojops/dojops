/**
 * Maps file patterns to validation tools for the DevSecOps reviewer.
 *
 * Data-only — no I/O, no child_process.
 * The actual tool execution is handled by the caller (api/cli layer)
 * using @dojops/runtime's binary verifier or safe-exec.
 */

export interface ReviewToolSpec {
  /** Glob-like patterns to match files (checked with simple suffix/basename matching) */
  patterns: string[];
  /** Tool binary name (must be in ALLOWED_VERIFICATION_BINARIES whitelist) */
  binary: string;
  /** Arguments template. `{file}` is replaced with the actual file path. */
  args: string[];
  /** Parser name for structured output parsing (from @dojops/runtime parsers) */
  parser?: string;
  /** Human-readable description */
  description: string;
  /** Timeout in ms for this tool (default: 30000) */
  timeout?: number;
}

/**
 * Validation tools mapped to file types.
 * Order matters — first match wins for a given file.
 */
export const REVIEW_TOOL_MAP: ReviewToolSpec[] = [
  // ── CI/CD ──
  {
    patterns: [".github/workflows/*.yml", ".github/workflows/*.yaml"],
    binary: "actionlint",
    args: ["{file}"],
    parser: "actionlint",
    description: "GitHub Actions workflow syntax and best practices",
  },
  {
    patterns: [".github/actions/*/action.yml", ".github/actions/*/action.yaml"],
    binary: "actionlint",
    args: ["{file}"],
    parser: "actionlint",
    description: "GitHub Actions composite action validation",
  },
  {
    patterns: [".gitlab-ci.yml", ".gitlab-ci.yaml"],
    binary: "yamllint",
    args: ["-f", "parsable", "{file}"],
    description: "GitLab CI YAML syntax validation",
  },
  // ── Containers ──
  {
    patterns: ["Dockerfile", "Dockerfile.*", "*.dockerfile"],
    binary: "hadolint",
    args: ["--format", "json", "{file}"],
    parser: "hadolint-json",
    description: "Dockerfile best practices (DL/SC rules)",
  },
  {
    patterns: [
      "docker-compose.yml",
      "docker-compose.yaml",
      "compose.yml",
      "compose.yaml",
      "docker-compose.*.yml",
      "docker-compose.*.yaml",
    ],
    binary: "yamllint",
    args: ["-f", "parsable", "{file}"],
    description: "Docker Compose YAML syntax validation",
  },
  // ── Infrastructure as Code ──
  {
    patterns: ["*.tf"],
    binary: "terraform",
    args: ["validate", "-no-color"],
    description: "Terraform configuration validation",
    timeout: 60000,
  },
  {
    patterns: ["*.tf"],
    binary: "tflint",
    args: ["--format", "json", "{file}"],
    description: "Terraform linting and best practices",
  },
  // ── Kubernetes & Helm ──
  {
    patterns: ["Chart.yaml", "Chart.yml"],
    binary: "helm",
    args: ["lint", "{dir}"],
    description: "Helm chart structure and template validation",
  },
  {
    patterns: ["*.yaml", "*.yml"],
    binary: "kubectl",
    args: ["apply", "--dry-run=client", "-f", "{file}"],
    description: "Kubernetes manifest dry-run validation",
    timeout: 30000,
  },
  // ── Shell ──
  {
    patterns: ["*.sh", "*.bash"],
    binary: "shellcheck",
    args: ["--format", "json", "{file}"],
    description: "Shell script analysis (SC rules)",
  },
  // ── Monitoring ──
  {
    patterns: ["prometheus.yml", "prometheus.yaml"],
    binary: "promtool",
    args: ["check", "config", "{file}"],
    description: "Prometheus configuration validation",
  },
  // ── Systemd ──
  {
    patterns: ["*.service", "*.timer", "*.socket"],
    binary: "systemd-analyze",
    args: ["verify", "{file}"],
    description: "Systemd unit file validation",
  },
  // ── Security scanning ──
  {
    patterns: ["Dockerfile", "Dockerfile.*", "*.tf", "*.yaml", "*.yml"],
    binary: "checkov",
    args: ["-f", "{file}", "--quiet", "--compact", "--framework", "all"],
    description: "Infrastructure-as-code security scanning",
    timeout: 60000,
  },
  {
    patterns: ["Dockerfile", "Dockerfile.*", "*.tf", "*.yaml", "*.yml"],
    binary: "trivy",
    args: ["config", "--severity", "HIGH,CRITICAL", "{file}"],
    description: "Misconfigurations and security scanning",
    timeout: 60000,
  },
  // ── Generic YAML (fallback) ──
  {
    patterns: ["*.yaml", "*.yml"],
    binary: "yamllint",
    args: ["-f", "parsable", "{file}"],
    description: "YAML syntax validation",
  },
];

/**
 * Match a file path against a ReviewToolSpec pattern.
 * Supports simple glob matching: `*` matches any non-separator chars.
 */
function matchPattern(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");

  // Split both into segments
  const pathParts = normalizedPath.split("/");
  const patternParts = normalizedPattern.split("/");

  // Pattern must match from the end (e.g. "Dockerfile" matches "src/Dockerfile")
  if (patternParts.length > pathParts.length) return false;

  const offset = pathParts.length - patternParts.length;
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const fp = pathParts[offset + i];

    if (pp === "*") continue;
    if (pp.includes("*")) {
      // Simple wildcard: "*.sh" or "Dockerfile.*"
      const regex = new RegExp(
        "^" + pp.replaceAll(".", String.raw`\.`).replaceAll("*", ".*") + "$",
      );
      if (!regex.test(fp)) return false;
    } else if (pp !== fp) {
      return false;
    }
  }
  return true;
}

/**
 * Find all matching validation tools for a given file path.
 * Returns all matches (a file may be validated by multiple tools).
 */
export function findToolsForFile(filePath: string): ReviewToolSpec[] {
  return REVIEW_TOOL_MAP.filter((spec) => spec.patterns.some((p) => matchPattern(filePath, p)));
}

/**
 * Deduplicate tool specs: if multiple files map to the same binary,
 * return unique tool specs.
 */
export function getUniqueTools(filePaths: string[]): Map<string, ReviewToolSpec[]> {
  const result = new Map<string, ReviewToolSpec[]>();
  for (const fp of filePaths) {
    const tools = findToolsForFile(fp);
    if (tools.length > 0) {
      result.set(fp, tools);
    }
  }
  return result;
}
