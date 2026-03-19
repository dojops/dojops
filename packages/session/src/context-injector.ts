import fs from "node:fs";
import path from "node:path";
import {
  parseDojopsMdString,
  discoverDevOpsFiles,
  loadIgnorePatterns,
  isIgnored,
} from "@dojops/core";
import type { RepoContext } from "@dojops/core";

/** Load project context from DOJOPS.md (preferred) or .dojops/context.json (legacy). */
function loadProjectContext(rootDir: string, parts: string[]): void {
  const ctx = loadRepoContext(rootDir);
  if (!ctx) return;

  parts.push("## Project Context");
  if (ctx.primaryLanguage) parts.push(`Primary language: ${ctx.primaryLanguage}`);
  if (ctx.languages?.length > 1) {
    const others = ctx.languages.filter((l) => l.name !== ctx.primaryLanguage).map((l) => l.name);
    if (others.length > 0) parts.push(`Other languages: ${others.join(", ")}`);
  }
  if (ctx.packageManager) parts.push(`Package manager: ${ctx.packageManager.name}`);
  if (ctx.ci.length > 0) {
    const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
    parts.push(`CI/CD: ${platforms}`);
  }
  if (ctx.container.hasDockerfile) parts.push("Has Dockerfile");
  if (ctx.container.hasCompose) parts.push("Has Docker Compose");
  if (ctx.infra.hasTerraform) parts.push("Has Terraform");
  if (ctx.infra.hasKubernetes) parts.push("Has Kubernetes");
  if (ctx.infra.hasHelm) parts.push("Has Helm");
  if (ctx.infra.hasAnsible) parts.push("Has Ansible");
  if (ctx.meta.isMonorepo) parts.push("Monorepo structure");
  if (ctx.llmInsights?.projectDescription) {
    parts.push(`\nSummary: ${ctx.llmInsights.projectDescription}`);
  }
}

/** Try DOJOPS.md first, then fall back to legacy context.json. */
function loadRepoContext(rootDir: string): RepoContext | null {
  // Try DOJOPS.md
  const mdPath = path.join(rootDir, "DOJOPS.md");
  if (fs.existsSync(mdPath)) {
    try {
      const content = fs.readFileSync(mdPath, "utf-8");
      const { context } = parseDojopsMdString(content, rootDir);
      if (context) return context;
    } catch {
      // Fall through
    }
  }

  // Legacy: .dojops/context.json
  const jsonPath = path.join(rootDir, ".dojops", "context.json");
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as RepoContext;
  } catch {
    return null;
  }
}

/** Load latest scan summary from .dojops/scan-history/. */
function loadLatestScanSummary(rootDir: string, parts: string[]): void {
  const scanDir = path.join(rootDir, ".dojops", "scan-history");
  if (!fs.existsSync(scanDir)) return;
  try {
    const files = fs
      .readdirSync(scanDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    if (files.length === 0) return;
    const latest = JSON.parse(fs.readFileSync(path.join(scanDir, files[0]), "utf-8"));
    if (typeof latest.summary !== "string" || latest.summary.length > 4096) return;
    // Sanitize: strip control chars and bidi markers to prevent prompt injection
    const safeSummary = latest.summary.replaceAll(
      // NOSONAR - complex character class
      // eslint-disable-next-line no-control-regex
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
      "",
    );
    parts.push(`\n## Latest Security Scan`, safeSummary);
  } catch {
    // Skip
  }
}

/** Load session state from .dojops/session.json. */
function loadSessionState(rootDir: string, parts: string[]): void {
  const sessionFile = path.join(rootDir, ".dojops", "session.json");
  if (!fs.existsSync(sessionFile)) return;
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    if (session.currentPlan) parts.push(`\n## Active Plan: ${session.currentPlan}`);
    if (session.mode && session.mode !== "IDLE") parts.push(`Current mode: ${session.mode}`);
  } catch {
    // Skip
  }
}

/** Build a lightweight file tree (max depth, skip hidden/node_modules). */
export function buildFileTree(
  rootDir: string,
  maxDepth: number = 3,
  maxEntries: number = 120,
): string {
  const lines: string[] = [];
  const SKIP = new Set(["node_modules", ".git", ".dojops", "__pycache__", ".next", "dist", "out"]);
  const ignorePatterns = loadIgnorePatterns(rootDir);

  function walk(dir: string, prefix: string, depth: number, relDir: string): void {
    if (depth > maxDepth || lines.length >= maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort: dirs first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (lines.length >= maxEntries) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (ignorePatterns.length > 0 && isIgnored(relPath, ignorePatterns)) continue;
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        walk(path.join(dir, entry.name), prefix + "  ", depth + 1, relPath);
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
  }

  walk(rootDir, "", 0, "");
  return lines.join("\n");
}

/** Maximum total size for injected DevOps file contents (~24KB ≈ ~6K tokens). */
const MAX_DEVOPS_CONTENT_SIZE = 24 * 1024;

/**
 * Discover and inject actual DevOps file contents into the context.
 * This allows agents to analyze CI/CD, Docker, Terraform, etc. files directly.
 */
function loadDevOpsFileContents(rootDir: string, parts: string[]): void {
  try {
    const files = discoverDevOpsFiles(rootDir);
    if (files.length === 0) return;

    parts.push(
      `\n## Project DevOps Files`,
      "The following are the actual contents of DevOps configuration files in the project.",
      "Use these to provide specific analysis when asked about the project's CI/CD, infrastructure, or configuration.",
    );

    let totalSize = 0;
    let includedCount = 0;
    for (const file of files) {
      const entrySize = file.path.length + file.content.length + 20; // overhead for formatting
      if (totalSize + entrySize > MAX_DEVOPS_CONTENT_SIZE) break;
      parts.push(`\n### \`${file.path}\`\n\`\`\`\n${file.content}\n\`\`\``);
      totalSize += entrySize;
      includedCount++;
    }

    if (includedCount < files.length) {
      parts.push(
        `\n*${files.length - includedCount} additional DevOps files not shown (context limit).*`,
      );
    }
  } catch {
    // Non-fatal — continue without file contents
  }
}

export function buildSessionContext(rootDir: string): string {
  const parts: string[] = [];
  loadProjectContext(rootDir, parts);

  // Add file tree so LLM knows actual project structure
  const tree = buildFileTree(rootDir);
  if (tree) {
    parts.push(`\n## Project File Tree`, "```", tree, "```");
  }

  // Inject actual DevOps file contents for analysis
  loadDevOpsFileContents(rootDir, parts);

  loadLatestScanSummary(rootDir, parts);
  loadSessionState(rootDir, parts);
  return parts.length > 0 ? parts.join("\n") : "";
}
