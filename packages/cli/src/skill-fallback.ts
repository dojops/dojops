import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { LLMProvider } from "@dojops/core";
import { CLIContext } from "./types";
import {
  DEFAULT_HUB_URL,
  resolveLatestVersion,
  downloadAndVerify,
  parseDownloadedSkill,
  resolveInstallDir,
} from "./commands/skills";
import type { SearchPackage } from "./commands/skills";
import { isOfflineMode } from "./offline";

type DocAugmenter = { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };
type Context7Provider = {
  resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
};

/** Words stripped during search term extraction. */
const STOP_WORDS = new Set([
  "create",
  "generate",
  "set",
  "up",
  "configure",
  "build",
  "make",
  "write",
  "add",
  "setup",
  "deploy",
  "install",
  "init",
  "initialize",
  "scaffold",
  "plan",
  "execute",
  "run",
  "implement",
  "define",
  "prepare",
  "a",
  "an",
  "the",
  "for",
  "my",
  "me",
  "with",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "new",
  "please",
  "config",
  "configuration",
  "file",
]);

/**
 * Extract meaningful search terms from a prompt by stripping action verbs,
 * articles, and filler words. Returns up to 3 keywords joined by space.
 * Hub uses PostgreSQL plainto_tsquery (AND logic) — fewer terms match better.
 */
export function extractSearchTerms(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // NOSONAR - character class pattern
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  if (words.length === 0) {
    return prompt.slice(0, 60).trim();
  }
  return words.slice(0, 3).join(" ");
}

/**
 * Run a single hub search request. Returns packages or empty array on failure.
 */
async function fetchHubSearch(
  query: string,
  hubUrl: string,
  verbose: boolean,
): Promise<SearchPackage[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `${hubUrl}/api/search?q=${encodeURIComponent(query)}&limit=5`;
    if (verbose) p.log.info(pc.dim(`Hub search: ${url}`));
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      if (verbose) p.log.info(pc.dim(`Hub returned HTTP ${res.status}`));
      return [];
    }

    const data = await res.json();
    const packages: SearchPackage[] =
      data.packages ?? data.results ?? (Array.isArray(data) ? data : []);
    if (verbose) p.log.info(pc.dim(`Hub returned ${packages.length} result(s) for "${query}"`));
    return packages;
  } catch (err) {
    if (verbose) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.info(pc.dim(`Hub search failed: ${msg}`));
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search the DojOps Hub for matching skills. Returns an empty array on any failure.
 * Uses progressive fallback: tries the full query first, then fewer terms if no results.
 * This handles PostgreSQL plainto_tsquery AND matching where too many terms cause misses.
 */
export async function searchHub(
  query: string,
  hubUrl: string,
  verbose = false,
): Promise<SearchPackage[]> {
  // Skip network requests in offline mode
  if (isOfflineMode()) {
    if (verbose) p.log.info(pc.dim("Offline mode: skipping hub search"));
    return [];
  }

  // Try full query first
  const results = await fetchHubSearch(query, hubUrl, verbose);
  if (results.length > 0) return results;

  // Progressive fallback: try with fewer terms
  const words = query.split(" ").filter((w) => w.length > 0);
  if (words.length <= 1) return results;

  // Retry with first 2 terms, then first term only
  for (const count of [2, 1]) {
    if (words.length <= count) continue;
    const shorter = words.slice(0, count).join(" ");
    if (verbose) p.log.info(pc.dim(`Retrying with fewer terms: "${shorter}"`));
    const fallback = await fetchHubSearch(shorter, hubUrl, verbose);
    if (fallback.length > 0) return fallback;
  }

  return [];
}

/**
 * Prompt the user to select a hub skill to install.
 * Returns the selected package or null if skipped/cancelled.
 */
export async function promptHubInstall(
  ctx: CLIContext,
  packages: SearchPackage[],
): Promise<SearchPackage | null> {
  if (packages.length === 0) return null;

  // Non-interactive without --yes: skip to Context7
  if (!ctx.globalOpts.nonInteractive && !process.stdout.isTTY) {
    return null;
  }

  // --yes mode: auto-select first result
  if (ctx.globalOpts.nonInteractive) {
    const first = packages[0];
    p.log.info(`Auto-selecting hub skill: ${pc.cyan(first.name)}`);
    return first;
  }

  // Interactive: show select prompt
  const options = packages.map((pkg) => {
    const ver = pkg.latestVersion?.semver ? `v${pkg.latestVersion.semver}` : "";
    const stars = pkg.starCount == null ? "" : `★${pkg.starCount}`;
    const hint = [ver, stars, pkg.description?.slice(0, 50)].filter(Boolean).join(" · ");
    return { value: pkg.slug, label: pkg.name, hint };
  });
  options.push({ value: "__skip__", label: "Skip", hint: "continue without installing" });

  const choice = await p.select({
    message: "A matching skill was found on DojOps Hub. Install?",
    options,
  });

  if (p.isCancel(choice) || choice === "__skip__") return null;

  return packages.find((pkg) => pkg.slug === choice) ?? null;
}

/**
 * Install a skill from the hub to the global skills directory.
 * Returns true on success, false on any failure.
 */
export async function installHubSkill(slug: string, skillName: string): Promise<boolean> {
  try {
    const version = await resolveLatestVersion(slug, skillName);
    const { fileBuffer } = await downloadAndVerify(slug, version, skillName);
    await parseDownloadedSkill(fileBuffer);

    const destDir = resolveInstallDir(true);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, `${skillName}.dops`);
    fs.writeFileSync(destPath, fileBuffer);

    p.log.success(`Installed ${pc.cyan(skillName)} v${version} from hub`);
    return true;
  } catch (err) {
    p.log.warn(
      `Could not install "${skillName}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Generate content using the LLM with optional Context7 documentation augmentation.
 * Returns generated content or null on failure.
 */
export async function context7LlmFallback(
  prompt: string,
  provider: LLMProvider,
  docAugmenter: DocAugmenter | undefined,
  _context7Provider: Context7Provider | undefined,
  projectContextStr: string | undefined,
): Promise<string | null> {
  const keywords = extractSearchTerms(prompt)
    .split(" ")
    .filter((w) => w.length > 0);

  let systemPrompt =
    "You are a DevOps configuration generator. Generate production-ready configuration " +
    "based on the user's request. Output raw file content directly — do not wrap in JSON " +
    "or code fences unless the format requires it.";

  if (projectContextStr) {
    systemPrompt += `\n\nProject context: ${projectContextStr}`;
  }

  // Augment with Context7 documentation if available
  if (docAugmenter) {
    try {
      systemPrompt = await docAugmenter.augmentPrompt(systemPrompt, keywords, prompt);
    } catch {
      // Context7 failure is non-blocking
    }
  }

  try {
    const result = await provider.generate({ system: systemPrompt, prompt });
    return result.content || null;
  } catch {
    return null;
  }
}

/**
 * Display a suggestion to create a custom skill.
 */
export function suggestCustomSkill(searchTerms: string): void {
  const name = searchTerms
    .split(" ")
    .slice(0, 3)
    .join("-")
    .replace(/[^a-z0-9-]/g, ""); // NOSONAR - character class pattern
  p.log.info(pc.dim("For more accurate results, consider creating a custom skill:"));
  p.log.info(pc.dim(`  $ dojops skills init "${name || "my-skill"}"`));
}

/**
 * Display a warning that no matching skill is available and LLM output
 * cannot be validated. Suggests creating a custom skill.
 */
export function warnNoSkill(searchTerms: string): void {
  const skillName =
    searchTerms
      .split(" ")
      .slice(0, 3)
      .join("-")
      .replace(/[^a-z0-9-]/g, "") || "my-skill"; // NOSONAR - character class pattern
  p.log.warn(
    `No matching skill "${pc.cyan(skillName)}" available. ` + "Unable to validate LLM output.",
  );
  p.log.info(
    pc.dim(`Consider creating a skill to enhance LLM output quality:\n`) +
      pc.dim(`  $ dojops skills init "${skillName}"`),
  );
}

/** Options for the skill fallback flow. */
export interface SkillFallbackOptions {
  writePath: string | undefined;
  allowAllPaths: boolean;
  projectRoot: string | undefined;
  provider: LLMProvider;
  docAugmenter: DocAugmenter | undefined;
  context7Provider: Context7Provider | undefined;
  projectContextStr: string | undefined;
}

/** Whether the output mode is structured (JSON/YAML/stream). */
function isStructuredOutput(ctx: CLIContext): boolean {
  return (
    ctx.globalOpts.output === "json" ||
    ctx.globalOpts.output === "yaml" ||
    ctx.globalOpts.output === "stream-json" ||
    ctx.globalOpts.raw
  );
}

/**
 * Tier 1: Search the hub for matching skills and offer interactive install.
 * Returns "retry" if a skill was installed, null to continue to tier 2.
 */
async function tryHubSearch(
  ctx: CLIContext,
  searchTerms: string,
  structured: boolean,
): Promise<"retry" | null> {
  const hubUrl = DEFAULT_HUB_URL;
  const s = p.spinner();
  if (!structured) s.start("Searching hub for matching skills...");

  const packages = await searchHub(searchTerms, hubUrl, ctx.globalOpts.verbose);

  if (!structured) {
    const msg =
      packages.length > 0
        ? `Found ${packages.length} matching skill(s) on hub`
        : "No matching skills on hub";
    s.stop(msg);
  }

  if (packages.length === 0) return null;

  const selected = await promptHubInstall(ctx, packages);
  if (!selected) return null;

  const installSpinner = p.spinner();
  if (!structured) installSpinner.start(`Installing ${pc.cyan(selected.name)}...`);

  const installed = await installHubSkill(selected.slug, selected.name);

  if (!structured) installSpinner.stop(installed ? "Installed" : "Install failed");

  return installed ? "retry" : null;
}

/**
 * Tier 2: Generate content via Context7 + LLM and emit output.
 * Returns "handled" if content was generated, "skip" otherwise.
 */
async function tryLlmFallback(
  ctx: CLIContext,
  prompt: string,
  opts: SkillFallbackOptions,
  structured: boolean,
): Promise<"handled" | "skip"> {
  if (!structured) {
    p.log.info(pc.dim("No matching skill found. Generating with documentation-augmented LLM..."));
  }

  const s2 = p.spinner();
  if (!structured) s2.start("Generating...");

  const content = await context7LlmFallback(
    prompt,
    opts.provider,
    opts.docAugmenter,
    opts.context7Provider,
    opts.projectContextStr,
  );

  if (!structured) s2.stop("Done.");

  if (!content) return "skip";

  await emitFallbackContent(ctx, content, opts.writePath, opts.allowAllPaths);
  return "handled";
}

/** Write or print the generated fallback content. */
async function emitFallbackContent(
  ctx: CLIContext,
  content: string,
  writePath: string | undefined,
  allowAllPaths: boolean,
): Promise<void> {
  if (writePath) {
    const { handleWriteOutput } = await import("./commands/generate");
    await handleWriteOutput(ctx, writePath, allowAllPaths, content, "context7-llm");
  } else if (ctx.globalOpts.raw) {
    process.stdout.write(content);
    if (!content.endsWith("\n")) process.stdout.write("\n");
  } else {
    const { outputFormatted } = await import("./commands/generate");
    outputFormatted(ctx.globalOpts.output, "fallback", "context7-llm", content);
  }
}

/**
 * Two-tier fallback between skill matching and agent routing.
 *
 * Tier 1: Search DojOps Hub for a matching skill and offer interactive install.
 * Tier 2: Use Context7 documentation + LLM to generate content directly.
 *
 * Returns "handled" if content was generated, "retry" if a hub skill was installed
 * and skill matching should re-run, or "skip" to fall through to agent routing.
 */
export async function trySkillFallback(
  ctx: CLIContext,
  prompt: string,
  opts: SkillFallbackOptions,
): Promise<"handled" | "retry" | "skip"> {
  const { isAnalysisIntent } = await import("./commands/generate");
  if (isAnalysisIntent(prompt)) return "skip";

  const searchTerms = extractSearchTerms(prompt);
  const structured = isStructuredOutput(ctx);

  // Tier 1: hub search + install
  const hubResult = await tryHubSearch(ctx, searchTerms, structured);
  if (hubResult) return hubResult;

  // Tier 2: Context7 + LLM fallback
  if (!opts.docAugmenter && !opts.context7Provider) {
    if (!structured) warnNoSkill(searchTerms);
    return "skip";
  }

  const llmResult = await tryLlmFallback(ctx, prompt, opts, structured);

  if (!structured) warnNoSkill(searchTerms);
  return llmResult;
}
