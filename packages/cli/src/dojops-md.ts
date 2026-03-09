import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  parseDojopsMdString,
  extractNotesSection,
  extractCustomSections,
  extractActivityEntries,
} from "@dojops/core";
import type { RepoContext } from "@dojops/core";

const MAX_ACTIVITY_ENTRIES = 20;
const MAX_ENTRY_LENGTH = 200;
const DOJOPS_MD_FILENAME = "DOJOPS.md";

// ── Read ────────────────────────────────────────────────────────────

/** Resolve the DOJOPS.md path for a project root. */
export function dojopsMdPath(rootDir: string): string {
  return path.join(rootDir, DOJOPS_MD_FILENAME);
}

/**
 * Load RepoContext from DOJOPS.md at the project root.
 * Returns null if the file doesn't exist or parsing fails.
 */
export function loadDojopsMd(rootDir: string): RepoContext | null {
  const filePath = dojopsMdPath(rootDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { context } = parseDojopsMdString(content, rootDir);
    return context;
  } catch {
    return null;
  }
}

// ── Write ───────────────────────────────────────────────────────────

/** Build YAML frontmatter from a RepoContext, preserving custom user keys. */
function buildFrontmatter(ctx: RepoContext, existingRaw?: Record<string, unknown> | null): string {
  // Start with any existing custom keys the user may have added
  const base: Record<string, unknown> = existingRaw ? { ...existingRaw } : {};

  // Remove keys that are internal to RepoContext but not stored in DOJOPS.md
  delete base.version;
  delete base.rootPath;

  // Overwrite with fresh scanner data
  const fm: Record<string, unknown> = {
    ...base,
    dojops: 1,
    scannedAt: ctx.scannedAt,
    primaryLanguage: ctx.primaryLanguage,
    languages: ctx.languages,
    packageManager: ctx.packageManager,
    ci: ctx.ci,
    container: ctx.container,
    infra: ctx.infra,
    monitoring: ctx.monitoring,
    scripts: ctx.scripts,
    security: ctx.security,
    meta: ctx.meta,
    relevantDomains: ctx.relevantDomains,
    devopsFiles: ctx.devopsFiles,
  };
  if (ctx.llmInsights) fm.llmInsights = ctx.llmInsights;

  return yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false });
}

// ── Body generation ─────────────────────────────────────────────────

/** Build the ## Overview section from context data. */
function buildOverviewSection(ctx: RepoContext): string {
  const lines: string[] = ["## Overview", ""];

  // Project description from LLM insights or fallback
  const desc = ctx.llmInsights?.projectDescription;
  if (desc) {
    lines.push(desc, "");
  }

  // Tech stack line (deduplicated — normalized to lowercase for matching,
  // also checks if the existing set contains or is contained by the new item)
  const stack: string[] = [];
  const seenLower = new Set<string>();
  const addUnique = (item: string): void => {
    const lower = item.toLowerCase();
    // Skip if already seen exactly, or if an existing entry contains/matches this one
    // e.g., "Node.js" already in set → skip "node"
    if (seenLower.has(lower)) return;
    for (const s of seenLower) {
      if (s.includes(lower) || lower.includes(s)) return;
    }
    seenLower.add(lower);
    stack.push(item);
  };
  // LLM tech stack first (it's the most curated)
  if (ctx.llmInsights?.techStack?.length) {
    for (const t of ctx.llmInsights.techStack) addUnique(t);
  }
  // Fill in from scanner data
  if (ctx.primaryLanguage) addUnique(ctx.primaryLanguage);
  if (ctx.container.hasDockerfile) addUnique("Docker");
  if (ctx.ci.length > 0) {
    for (const c of ctx.ci) addUnique(c.platform);
  }
  if (stack.length > 0) {
    lines.push(`**Tech Stack:** ${stack.join(", ")}`, "");
  }

  // Recommended agents
  const agents = ctx.llmInsights?.recommendedAgents;
  if (agents && agents.length > 0) {
    lines.push(`**Recommended Agents:** ${agents.join(", ")}`, "");
  }

  return lines.join("\n");
}

/** Collect container-related items from context. */
function collectContainerItems(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.container.hasDockerfile) items.push("Dockerfile");
  if (ctx.container.hasCompose) {
    items.push(`Docker Compose (\`${ctx.container.composePath ?? "compose.yml"}\`)`);
  }
  return items;
}

/** Collect infrastructure-related items from context. */
function collectInfraItems(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.infra.hasTerraform) {
    const providers =
      ctx.infra.tfProviders.length > 0 ? ` (${ctx.infra.tfProviders.join(", ")})` : "";
    items.push(`Terraform${providers}`);
  }
  const infraFlags: [boolean, string][] = [
    [ctx.infra.hasKubernetes, "Kubernetes"],
    [ctx.infra.hasHelm, "Helm"],
    [ctx.infra.hasAnsible, "Ansible"],
    [ctx.infra.hasKustomize, "Kustomize"],
    [ctx.infra.hasPulumi, "Pulumi"],
    [ctx.infra.hasCloudFormation, "CloudFormation"],
  ];
  for (const [flag, name] of infraFlags) {
    if (flag) items.push(name);
  }
  return items;
}

/** Collect monitoring-related items from context. */
function collectMonitoringItems(ctx: RepoContext): string[] {
  const flags: [boolean, string][] = [
    [ctx.monitoring.hasPrometheus, "Prometheus"],
    [ctx.monitoring.hasNginx, "Nginx"],
    [ctx.monitoring.hasSystemd, "systemd"],
  ];
  return flags.filter(([flag]) => flag).map(([, name]) => name);
}

/** Collect project structure metadata items from context. */
function collectMetaItems(ctx: RepoContext): string[] {
  const flags: [boolean, string][] = [
    [ctx.meta.isMonorepo, "monorepo"],
    [ctx.meta.hasMakefile, "Makefile"],
  ];
  return flags.filter(([flag]) => flag).map(([, name]) => name);
}

/** Build the ## Detected Stack section from scanner data. */
function buildDetectedSection(ctx: RepoContext): string {
  const lines: string[] = ["## Detected Stack", ""];
  const items: string[] = [];

  if (ctx.primaryLanguage) {
    const others = ctx.languages.map((l) => l.name).filter((n) => n !== ctx.primaryLanguage);
    const suffix = others.length > 0 ? ` (also: ${others.join(", ")})` : "";
    items.push(`**Primary Language:** ${ctx.primaryLanguage}${suffix}`);
  }
  if (ctx.packageManager) {
    const lock = ctx.packageManager.lockfile ? ` (${ctx.packageManager.lockfile})` : "";
    items.push(`**Package Manager:** ${ctx.packageManager.name}${lock}`);
  }
  if (ctx.ci.length > 0) {
    const ciParts = ctx.ci.map((c) => `${c.platform} (\`${c.configPath}\`)`);
    items.push(`**CI/CD:** ${ciParts.join(", ")}`);
  }

  const containers = collectContainerItems(ctx);
  if (containers.length > 0) items.push(`**Container:** ${containers.join(", ")}`);

  const infra = collectInfraItems(ctx);
  if (infra.length > 0) items.push(`**Infrastructure:** ${infra.join(", ")}`);

  const mon = collectMonitoringItems(ctx);
  if (mon.length > 0) items.push(`**Monitoring:** ${mon.join(", ")}`);

  const meta = collectMetaItems(ctx);
  if (meta.length > 0) items.push(`**Structure:** ${meta.join(", ")}`);

  for (const item of items) lines.push(`- ${item}`);

  if (ctx.devopsFiles.length > 0) {
    lines.push("", "**DevOps Files:**");
    for (const f of ctx.devopsFiles) lines.push(`- \`${f}\``);
  }

  lines.push("");
  return lines.join("\n");
}

/** Build the ## Suggested Workflows section. */
function buildSuggestedSection(ctx: RepoContext): string {
  const workflows = ctx.llmInsights?.suggestedWorkflows;
  if (!workflows || workflows.length === 0) return "";

  const lines: string[] = ["## Suggested Workflows", "", "```bash"];
  for (const w of workflows) {
    lines.push(`dojops "${w.command}"  # ${w.description}`);
  }
  lines.push("```", "");
  return lines.join("\n");
}

/** Build the full markdown body from context, preserving user-edited sections. */
function buildBody(
  ctx: RepoContext,
  notesContent: string,
  activityEntries: string[],
  customSections: string,
): string {
  const parts: string[] = [
    "# DojOps Project Context",
    "",
    "> Managed by DojOps CLI. Run `dojops init` to refresh. The Notes section is yours to edit.",
    "",
    buildOverviewSection(ctx),
  ];

  // If we have an LLM-generated analysis, use it as the primary content
  // (like Claude Code's /init — deep project understanding)
  const analysis = ctx.llmInsights?.projectAnalysis;
  if (analysis) {
    parts.push(analysis.trim(), "");
  }

  // Always include detected stack (scanner data)
  parts.push(buildDetectedSection(ctx));

  const suggested = buildSuggestedSection(ctx);
  if (suggested) parts.push(suggested);

  // User-added custom sections (preserved as-is)
  if (customSections) {
    parts.push(customSections, "");
  }

  // Notes section (user-owned, never overwritten)
  parts.push("## Notes", "");
  if (notesContent) {
    parts.push(notesContent);
  } else {
    parts.push(
      "<!-- Add project-specific notes, conventions, or preferences below. -->",
      "<!-- DojOps preserves this section across re-init and updates. -->",
    );
  }

  // Activity section (managed by CLI)
  const activityBlock = activityEntries.length > 0 ? activityEntries.join("\n") + "\n" : "";
  parts.push(
    "",
    "## Recent Activity",
    "",
    "<!-- activity-start -->",
    activityBlock + "<!-- activity-end -->",
    "",
  );

  return parts.join("\n");
}

/**
 * Write DOJOPS.md to the project root.
 *
 * Generates a rich body from context data. On re-init, preserves:
 * - The Notes section (user-owned)
 * - Activity entries
 * - Any custom ## sections the user added
 */
export function writeDojopsMd(rootDir: string, ctx: RepoContext): void {
  const filePath = dojopsMdPath(rootDir);
  let notesContent = "";
  let activityEntries: string[] = [];
  let customSections = "";
  let existingRaw: Record<string, unknown> | null = null;

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseDojopsMdString(content, rootDir);
    notesContent = extractNotesSection(parsed.body);
    activityEntries = extractActivityEntries(parsed.body);
    customSections = extractCustomSections(parsed.body);
    existingRaw = parsed.rawFrontmatter;
  }

  const frontmatter = buildFrontmatter(ctx, existingRaw);
  const body = buildBody(ctx, notesContent, activityEntries, customSections);
  const output = `---\n${frontmatter}---\n\n${body}`;

  // Atomic write: tmp file + rename
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, output, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// ── Activity tracking ───────────────────────────────────────────────

/** Sanitize an activity description: strip control chars, truncate. */
function sanitizeEntry(description: string): string {
  const clean = description.replaceAll(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    "",
  );
  return clean.length > MAX_ENTRY_LENGTH ? clean.slice(0, MAX_ENTRY_LENGTH - 1) + "\u2026" : clean;
}

/**
 * Append an activity entry to the Recent Activity section in DOJOPS.md.
 * Newest entries are prepended. Capped at MAX_ACTIVITY_ENTRIES.
 */
export function appendActivity(rootDir: string, description: string): void {
  const filePath = dojopsMdPath(rootDir);
  if (!fs.existsSync(filePath)) return;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return;
  }

  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const entry = `- ${timestamp} \u2014 ${sanitizeEntry(description)}`;

  const existing = extractActivityEntries(content);
  const updated = [entry, ...existing].slice(0, MAX_ACTIVITY_ENTRIES);

  const activityBlock = updated.length > 0 ? updated.join("\n") + "\n" : "";

  // Replace content between activity markers
  const replaced = content.replace(
    /<!-- activity-start -->\n[\s\S]*?<!-- activity-end -->/,
    `<!-- activity-start -->\n${activityBlock}<!-- activity-end -->`,
  );

  if (replaced === content && !content.includes("<!-- activity-start -->")) {
    // No activity markers found — skip silently
    return;
  }

  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, replaced, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// ── Migration ───────────────────────────────────────────────────────

/**
 * Migrate from legacy context.json + context.md to DOJOPS.md.
 * Renames old files to .bak. Returns true if migration was performed.
 */
export function migrateLegacyContext(rootDir: string): boolean {
  const jsonPath = path.join(rootDir, ".dojops", "context.json");
  const mdPath = path.join(rootDir, ".dojops", "context.md");
  const dojopsMd = dojopsMdPath(rootDir);

  if (!fs.existsSync(jsonPath) || fs.existsSync(dojopsMd)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    // Inject version: 2 if missing for V1 contexts
    if (!data.version) data.version = 2;
    if (!data.rootPath) data.rootPath = rootDir;

    const ctx = data as RepoContext;
    const frontmatter = buildFrontmatter(ctx);
    const body = buildBody(ctx, "", [], "");
    const output = `---\n${frontmatter}---\n\n${body}`;

    fs.writeFileSync(dojopsMd, output, "utf-8");

    // Rename old files to .bak
    fs.renameSync(jsonPath, jsonPath + ".bak");
    if (fs.existsSync(mdPath)) {
      fs.renameSync(mdPath, mdPath + ".bak");
    }

    return true;
  } catch {
    return false;
  }
}
