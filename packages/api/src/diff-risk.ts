// ── Types ─────────────────────────────────────────────────────────

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface FileRiskScore {
  path: string;
  risk: RiskLevel;
  reasons: string[];
  changeType: "added" | "modified" | "deleted" | "renamed";
  linesChanged: number;
}

export interface DiffRiskReport {
  overallRisk: RiskLevel;
  files: FileRiskScore[];
  summary: string;
  suggestedReviewers: string[];
}

// ── Path risk classification ──────────────────────────────────────

interface PathRule {
  pattern: RegExp;
  score: number;
  reason: string;
  reviewer?: string;
}

const PATH_RULES: PathRule[] = [
  // CRITICAL (score 4)
  {
    pattern: /terraform\.tfstate/i,
    score: 4,
    reason: "Terraform state file",
    reviewer: "terraform-specialist",
  },
  {
    pattern: /\/(secrets|\.env|credentials)/i,
    score: 4,
    reason: "Secrets or credentials file",
    reviewer: "security-auditor",
  },
  {
    pattern: /\/rbac\b/i,
    score: 4,
    reason: "Kubernetes RBAC configuration",
    reviewer: "kubernetes-specialist",
  },
  {
    pattern: /networkpolic/i,
    score: 4,
    reason: "Kubernetes NetworkPolicy",
    reviewer: "kubernetes-specialist",
  },
  {
    pattern: /podsecuritypolic/i,
    score: 4,
    reason: "Kubernetes PodSecurityPolicy",
    reviewer: "kubernetes-specialist",
  },
  {
    pattern: /production\.(ya?ml|json|conf|cfg|ini)$/i,
    score: 4,
    reason: "Production configuration",
    reviewer: "sre-specialist",
  },
  {
    pattern: /\/prod\//i,
    score: 4,
    reason: "Production deployment path",
    reviewer: "sre-specialist",
  },

  // HIGH (score 3)
  {
    pattern: /\.tf$/i,
    score: 3,
    reason: "Terraform configuration",
    reviewer: "terraform-specialist",
  },
  { pattern: /\/helm\//i, score: 3, reason: "Helm chart", reviewer: "kubernetes-specialist" },
  {
    pattern: /\/k8s\//i,
    score: 3,
    reason: "Kubernetes directory",
    reviewer: "kubernetes-specialist",
  },
  {
    pattern: /\/manifests?\//i,
    score: 3,
    reason: "Kubernetes manifests",
    reviewer: "kubernetes-specialist",
  },
  {
    pattern: /\.github\/workflows\//i,
    score: 3,
    reason: "GitHub Actions pipeline",
    reviewer: "cicd-specialist",
  },
  {
    pattern: /\.gitlab-ci\.ya?ml$/i,
    score: 3,
    reason: "GitLab CI pipeline",
    reviewer: "cicd-specialist",
  },
  { pattern: /Jenkinsfile$/i, score: 3, reason: "Jenkins pipeline", reviewer: "cicd-specialist" },
  { pattern: /Dockerfile/i, score: 3, reason: "Dockerfile", reviewer: "docker-specialist" },
  {
    pattern: /docker-compose/i,
    score: 3,
    reason: "Docker Compose file",
    reviewer: "docker-specialist",
  },
  {
    pattern: /nginx\.(conf|cfg)/i,
    score: 3,
    reason: "Nginx configuration",
    reviewer: "infrastructure-specialist",
  },
  { pattern: /vault.*\.hcl$/i, score: 3, reason: "Vault policy", reviewer: "security-auditor" },

  // MEDIUM (score 2)
  {
    pattern: /\.(ts|js|tsx|jsx|py|go|rs|java|rb|cs)$/i,
    score: 2,
    reason: "Application source code",
  },
  {
    pattern: /test.*\.(ya?ml|tf|hcl)$/i,
    score: 2,
    reason: "Infrastructure test",
    reviewer: "terraform-specialist",
  },
  { pattern: /runbook/i, score: 2, reason: "Runbook documentation", reviewer: "sre-specialist" },
  {
    pattern: /prometheus/i,
    score: 2,
    reason: "Prometheus configuration",
    reviewer: "observability-specialist",
  },
  {
    pattern: /grafana/i,
    score: 2,
    reason: "Grafana configuration",
    reviewer: "observability-specialist",
  },
  {
    pattern: /alertmanager/i,
    score: 2,
    reason: "Alertmanager configuration",
    reviewer: "observability-specialist",
  },

  // LOW (score 1)
  { pattern: /\.(test|spec)\.(ts|js|tsx|jsx|py|go|rs)$/i, score: 1, reason: "Test file" },
  { pattern: /README/i, score: 1, reason: "README file" },
  { pattern: /\.gitignore$/i, score: 1, reason: "Git ignore rules" },
  { pattern: /\.editorconfig$/i, score: 1, reason: "Editor configuration" },
  { pattern: /\.(md|txt|rst)$/i, score: 1, reason: "Documentation file" },
  { pattern: /\.prettierrc|\.eslintrc|tsconfig/i, score: 1, reason: "Tooling configuration" },
];

// ── Change type multipliers ───────────────────────────────────────

const CHANGE_TYPE_MULTIPLIER: Record<FileRiskScore["changeType"], number> = {
  deleted: 1.5,
  modified: 1.0,
  added: 0.8,
  renamed: 0.7,
};

// ── Diff parser ───────────────────────────────────────────────────

interface ParsedFile {
  path: string;
  changeType: FileRiskScore["changeType"];
  linesChanged: number;
}

/** Parse unified diff format to extract file paths, change types, and line counts. */
export function parseDiff(diffContent: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = diffContent.split("\n");

  let currentFile: ParsedFile | null = null;

  for (const line of lines) {
    // Match "diff --git a/path b/path"
    const diffHeader = /^diff --git a\/(.+?) b\/(.+?)$/.exec(line);
    if (diffHeader) {
      if (currentFile) files.push(currentFile);
      const aPath = diffHeader[1];
      const bPath = diffHeader[2];
      currentFile = {
        path: bPath,
        changeType: aPath !== bPath ? "renamed" : "modified",
        linesChanged: 0,
      };
      continue;
    }

    // Detect new files
    if (line === "--- /dev/null" && currentFile) {
      currentFile.changeType = "added";
      continue;
    }

    // Detect deleted files
    if (line === "+++ /dev/null" && currentFile) {
      currentFile.changeType = "deleted";
      continue;
    }

    // Count changed lines (additions and deletions)
    if (currentFile && (line.startsWith("+") || line.startsWith("-"))) {
      // Skip diff metadata lines
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      currentFile.linesChanged++;
    }
  }

  if (currentFile) files.push(currentFile);

  return files;
}

// ── Risk scoring ──────────────────────────────────────────────────

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 4) return "CRITICAL";
  if (score >= 3) return "HIGH";
  if (score >= 2) return "MEDIUM";
  if (score >= 1) return "LOW";
  return "INFO";
}

/** Patterns that indicate a file is a test/doc and should cap its base score. */
const LOW_OVERRIDE_PATTERNS = [
  /\.(test|spec)\.(ts|js|tsx|jsx|py|go|rs)$/i,
  /README/i,
  /\.gitignore$/i,
  /\.editorconfig$/i,
];

function scoreFile(file: ParsedFile): FileRiskScore {
  const reasons: string[] = [];
  let maxScore = 0;

  // Check if this is a low-priority file (test, README, etc.)
  const isLowOverride = LOW_OVERRIDE_PATTERNS.some((p) => p.test(file.path));

  for (const rule of PATH_RULES) {
    if (rule.pattern.test(file.path)) {
      reasons.push(rule.reason);
      if (rule.score > maxScore) maxScore = rule.score;
    }
  }

  // Test/doc files get capped at score 1 even if they match higher rules
  if (isLowOverride && maxScore <= 2) {
    maxScore = 1;
  }

  // Apply change type multiplier
  const multiplier = CHANGE_TYPE_MULTIPLIER[file.changeType];
  const adjustedScore = maxScore * multiplier;

  // Lines changed boost: large changes get +0.5 score
  const sizeBoost = file.linesChanged > 100 ? 0.5 : 0;
  const finalScore = adjustedScore + sizeBoost;

  if (reasons.length === 0) {
    reasons.push("Unclassified file");
  }

  if (file.changeType === "deleted") {
    reasons.push("File deletion (higher risk)");
  }

  if (file.linesChanged > 100) {
    reasons.push(`Large change (${file.linesChanged} lines)`);
  }

  return {
    path: file.path,
    risk: scoreToRiskLevel(Math.round(finalScore)),
    reasons,
    changeType: file.changeType,
    linesChanged: file.linesChanged,
  };
}

function computeOverallRisk(files: FileRiskScore[]): RiskLevel {
  if (files.length === 0) return "INFO";

  const levels: RiskLevel[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  let maxIndex = 0;
  for (const file of files) {
    const idx = levels.indexOf(file.risk);
    if (idx > maxIndex) maxIndex = idx;
  }
  return levels[maxIndex];
}

function collectReviewers(files: FileRiskScore[]): string[] {
  const reviewerSet = new Set<string>();
  for (const file of files) {
    for (const rule of PATH_RULES) {
      if (rule.reviewer && rule.pattern.test(file.path)) {
        reviewerSet.add(rule.reviewer);
      }
    }
  }
  return [...reviewerSet].sort();
}

// ── Main entry point ──────────────────────────────────────────────

/** Classify risk for a git diff or infrastructure diff. */
export function classifyDiffRisk(diffContent: string): DiffRiskReport {
  const parsed = parseDiff(diffContent);
  const files = parsed.map(scoreFile);
  const overallRisk = computeOverallRisk(files);
  const suggestedReviewers = collectReviewers(files);

  const critCount = files.filter((f) => f.risk === "CRITICAL").length;
  const highCount = files.filter((f) => f.risk === "HIGH").length;
  const medCount = files.filter((f) => f.risk === "MEDIUM").length;
  const totalLines = files.reduce((sum, f) => sum + f.linesChanged, 0);

  const parts: string[] = [`${files.length} file(s) changed, ${totalLines} line(s) modified`];
  if (critCount > 0) parts.push(`${critCount} critical`);
  if (highCount > 0) parts.push(`${highCount} high risk`);
  if (medCount > 0) parts.push(`${medCount} medium risk`);

  return {
    overallRisk,
    files,
    summary: parts.join(", "),
    suggestedReviewers,
  };
}
