import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { DevSecOpsReviewer, findToolsForFile, discoverDevOpsFiles } from "@dojops/core";
import type { LLMProvider, ToolValidationResult, ReviewReport } from "@dojops/core";
import { runReviewTool } from "@dojops/runtime";
import { HistoryStore, logRouteError } from "../store";
import { ReviewRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

/** Result of the full review pipeline — reusable by both API route and CLI. */
export interface ReviewPipelineResult {
  report: ReviewReport;
  toolResults: ToolValidationResult[];
  filesReviewed: string[];
}

/**
 * Read file content from disk with path traversal protection.
 * Resolves the file relative to projectRoot, validates the real path stays inside projectRoot.
 */
function readFileContent(filePath: string, projectRoot: string): string {
  const absPath = path.resolve(projectRoot, filePath);
  let realResolved: string;
  let realRoot: string;
  try {
    realResolved = fs.realpathSync(absPath);
    realRoot = fs.realpathSync(projectRoot);
  } catch {
    throw new Error(`File path does not exist: ${filePath}`);
  }
  const isInsideRoot = realResolved === realRoot || realResolved.startsWith(realRoot + path.sep);
  if (!isInsideRoot) {
    throw new Error(`File path outside project directory: ${filePath}`);
  }
  return fs.readFileSync(absPath, "utf-8");
}

/** Resolve explicit file list, reading content from disk when not provided inline. */
function resolveExplicitFiles(
  files: { path: string; content?: string }[],
  projectRoot: string,
): { path: string; content: string }[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content ?? readFileContent(file.path, projectRoot),
  }));
}

/** Determine which files to review: explicit list, auto-discovered, or error. */
function resolveReviewFiles(opts: {
  files?: { path: string; content?: string }[];
  autoDiscover?: boolean;
  projectRoot: string;
}): { path: string; content: string }[] {
  const hasExplicitFiles = opts.files && opts.files.length > 0;
  if (hasExplicitFiles) {
    return resolveExplicitFiles(opts.files!, opts.projectRoot);
  }
  if (opts.autoDiscover !== false) {
    return discoverDevOpsFiles(opts.projectRoot);
  }
  throw new Error("No files provided and auto-discovery is disabled");
}

/**
 * Run the full DevSecOps review pipeline:
 * 1. Discover or resolve files
 * 2. Run matching validation tools against each file
 * 3. Optionally fetch Context7 docs
 * 4. Feed files + tool results + docs to DevSecOpsReviewer (LLM)
 * 5. Return structured ReviewReport
 *
 * This function is the single source of truth for the review pipeline.
 * Both the API route and CLI command call this.
 */
export async function runReviewPipeline(opts: {
  provider: LLMProvider;
  projectRoot: string;
  /** Explicit files (path + optional inline content). */
  files?: { path: string; content?: string }[];
  /** Auto-discover DevOps files if no explicit files provided. */
  autoDiscover?: boolean;
  /** Context7 doc provider for version/deprecation checking. */
  context7Provider?: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  };
  useContext7?: boolean;
}): Promise<ReviewPipelineResult> {
  const { provider, projectRoot, context7Provider, useContext7 } = opts;

  // ── Step 1: Resolve files ──
  const resolvedFiles = resolveReviewFiles({
    files: opts.files,
    autoDiscover: opts.autoDiscover,
    projectRoot,
  });

  if (resolvedFiles.length === 0) {
    throw new Error("No DevOps configuration files found in the project");
  }

  // ── Step 2: Run validation tools ──
  const toolResults: ToolValidationResult[] = [];
  for (const file of resolvedFiles) {
    const specs = findToolsForFile(file.path);
    for (const spec of specs) {
      toolResults.push(runReviewTool(file.path, spec, projectRoot));
    }
  }

  // ── Step 3: Fetch Context7 docs ──
  let context7Docs: string | undefined;
  if (useContext7 && context7Provider) {
    context7Docs = await fetchReviewDocs(context7Provider, resolvedFiles);
  }

  // ── Step 4: LLM review ──
  const reviewer = new DevSecOpsReviewer(provider);
  const report = await reviewer.review({
    files: resolvedFiles,
    toolResults,
    context7Docs,
  });

  return {
    report,
    toolResults,
    filesReviewed: resolvedFiles.map((f) => f.path),
  };
}

/**
 * POST /api/review
 *
 * Orchestrates the DevSecOps review pipeline via HTTP.
 * Supports both explicit file lists and auto-discovery mode.
 */
export function createReviewRouter(
  provider: LLMProvider,
  store: HistoryStore,
  rootDir?: string,
  context7Provider?: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  },
): Router {
  const router = Router();
  let reviewInProgress = false;

  router.post("/", validateBody(ReviewRequestSchema), async (req, res, next) => {
    if (reviewInProgress) {
      res.status(429).json({ error: "Review already in progress" });
      return;
    }
    reviewInProgress = true;
    const start = Date.now();

    try {
      const {
        files: inputFiles,
        autoDiscover,
        useContext7,
      } = req.body as {
        files: { path: string; content?: string }[];
        autoDiscover: boolean;
        useContext7: boolean;
      };

      const projectPath = rootDir ?? process.cwd();

      const result = await runReviewPipeline({
        provider,
        projectRoot: projectPath,
        files: inputFiles.length > 0 ? inputFiles : undefined,
        autoDiscover,
        context7Provider,
        useContext7,
      });

      const response = {
        report: result.report,
        toolsRun: result.toolResults.map((r) => ({
          tool: r.tool,
          file: r.file,
          passed: r.passed,
          issueCount: r.issues.length,
        })),
        filesReviewed: result.filesReviewed,
      };

      const entry = store.add({
        type: "review",
        request: {
          files: result.filesReviewed,
          autoDiscover,
          useContext7,
        },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      logRouteError(store, "review", req.body, start, err);
      next(err);
    } finally {
      reviewInProgress = false;
    }
  });

  return router;
}

/** Detect a doc lookup for a single file and add it to `lookups` if not already seen. */
function detectDocLookup(
  file: { path: string; content: string },
  seen: Set<string>,
  lookups: { name: string; query: string }[],
): void {
  const lower = file.path.toLowerCase();

  const isGitHubAction = lower.includes(".github/workflows") || lower.includes(".github/actions");
  if (isGitHubAction && !seen.has("github-actions")) {
    lookups.push({
      name: "github/docs",
      query: "GitHub Actions workflow syntax current action versions",
    });
    seen.add("github-actions");
  }

  const isDockerfile = lower.startsWith("dockerfile") || lower.endsWith(".dockerfile");
  if (isDockerfile && !seen.has("dockerfile")) {
    lookups.push({ name: "docker/docs", query: "Dockerfile best practices multi-stage build" });
    seen.add("dockerfile");
  }

  if (lower.endsWith(".tf") && !seen.has("terraform")) {
    lookups.push({
      name: "hashicorp/terraform",
      query: "Terraform configuration best practices provider versions",
    });
    seen.add("terraform");
  }

  const isYaml = lower.endsWith(".yaml") || lower.endsWith(".yml");
  const isK8sCandidate = isYaml && !seen.has("github-actions") && !seen.has("k8s");
  const hasK8sMarkers = file.content.includes("apiVersion:") || file.content.includes("kind:");
  if (isK8sCandidate && hasK8sMarkers) {
    lookups.push({
      name: "kubernetes/kubernetes",
      query: "Kubernetes manifest best practices API versions",
    });
    seen.add("k8s");
  }

  const isChartYaml = lower === "chart.yaml" || lower === "chart.yml";
  if (isChartYaml && !seen.has("helm")) {
    lookups.push({ name: "helm/helm", query: "Helm chart best practices Chart.yaml structure" });
    seen.add("helm");
  }

  const isShellScript = lower.endsWith(".sh") || lower.endsWith(".bash");
  if (isShellScript && !seen.has("shell")) {
    lookups.push({
      name: "koalaman/shellcheck",
      query: "ShellCheck rules common shell scripting mistakes",
    });
    seen.add("shell");
  }
}

/** Resolve a single doc lookup, returning the formatted doc string or undefined. */
async function resolveSingleDocLookup(
  context7Provider: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  },
  lookup: { name: string; query: string },
): Promise<string | undefined> {
  try {
    const lib = await context7Provider.resolveLibrary(lookup.name, lookup.query);
    if (!lib) return undefined;
    const docs = await context7Provider.queryDocs(lib.id, lookup.query);
    if (!docs) return undefined;
    return `### ${lib.name}\n\n${docs}`;
  } catch {
    // Context7 failure is non-fatal
    return undefined;
  }
}

/**
 * Fetch Context7 documentation relevant to the files being reviewed.
 */
async function fetchReviewDocs(
  context7Provider: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  },
  files: { path: string; content: string }[],
): Promise<string | undefined> {
  const lookups: { name: string; query: string }[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    detectDocLookup(file, seen, lookups);
  }

  const docParts: string[] = [];
  for (const lookup of lookups) {
    const doc = await resolveSingleDocLookup(context7Provider, lookup);
    if (doc) docParts.push(doc);
  }

  return docParts.length > 0 ? docParts.join("\n\n---\n\n") : undefined;
}
