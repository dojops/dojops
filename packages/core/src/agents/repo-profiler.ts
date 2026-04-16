import { z } from "zod";
import { LLMProvider } from "../llm/provider";
import { parseAndValidate } from "../llm/json-validator";
import { wrapAsData } from "../llm/sanitizer";
import type { RepoContext } from "../scanner/types";
import { PackageManagerSchema } from "../scanner/types";

const MAX_INPUT_BYTES = 128 * 1024;

/**
 * Structured repository profile produced by an LLM after the heuristic
 * scanner runs. Fields are nullable where the model cannot tell with
 * confidence — the profiler must never guess.
 */
export const RepoProfileSchema = z.object({
  primaryLanguage: z.string().nullable(),
  packageManager: PackageManagerSchema.nullable(),
  projectType: z
    .enum(["library", "cli", "webapp", "service", "mobile", "infra", "monorepo", "unknown"])
    .nullable(),
  buildTool: z.string().nullable(),
  testFramework: z.string().nullable(),
  frameworks: z.array(z.string()),
  hasCI: z.boolean(),
  hasDocker: z.boolean(),
  hasInfra: z.boolean(),
  isMonorepo: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export type RepoProfile = z.infer<typeof RepoProfileSchema>;

const REPO_PROFILER_SYSTEM_PROMPT = `You are a repository profiler. You read a directory listing plus a small set of key file snippets and produce a structured profile of the project: its primary language, package manager, project type, build/test tooling, frameworks, and whether CI, containers, and infrastructure-as-code are present.

Your output drives downstream generation of Dockerfiles, CI workflows, and compose files. Wrong answers here cause wrong generation — so prefer "null" over a guess whenever the evidence is ambiguous.

Rules:
1. Use only evidence visible in the provided file listing and snippets. Do NOT infer from file names alone unless the extension is unambiguous (e.g., \`pyproject.toml\` → Python, \`Cargo.toml\` → Rust).
2. For \`packageManager\`, return the manager implied by the lockfile present (package-lock.json → npm, yarn.lock → yarn, pnpm-lock.yaml → pnpm, bun.lockb → bun, poetry.lock → poetry, Cargo.lock → cargo, go.sum → go, Gemfile.lock → bundler, composer.lock → composer). If no lockfile is visible, return null.
3. For \`buildTool\` and \`testFramework\`, return null unless you see a clear indicator in package.json scripts, a config file (vitest.config, jest.config, pytest.ini, etc.), or CI config.
4. \`frameworks\` must list only frameworks whose dependency or config you can cite (react, next, express, fastify, django, fastapi, spring-boot, …). No marketing categories like "web" or "backend".
5. \`projectType\`:
   - "monorepo" if pnpm-workspace.yaml / nx.json / turbo.json / lerna.json or a root package.json with \`workspaces\` is present
   - "cli" if package.json has a \`bin\` field or a shebanged entry file
   - "library" if package.json has \`main\`/\`exports\` but no \`bin\`, \`start\` script, or server framework
   - "webapp" for a Next.js / Vite / CRA / Nuxt / SvelteKit project
   - "service" for Express / Fastify / NestJS / Spring Boot / FastAPI / Flask / Go HTTP servers
   - "infra" for repos whose root contains mostly Terraform / Kubernetes / Helm / Ansible / Pulumi files
   - "unknown" when none of the above is clearly indicated
6. \`confidence\` reflects your certainty in the whole profile — lower it when key evidence is missing.
7. \`rationale\` is one short sentence (<=160 chars) citing the strongest evidence you relied on. Do not repeat every field.
8. Do NOT invent package managers, build tools, or frameworks that are not mentioned in the provided context.
9. This is a single-shot interaction. Do NOT ask follow-up questions or offer to continue.

You MUST respond with valid JSON matching this schema:
{
  "primaryLanguage": "string | null",
  "packageManager": { "name": "string", "lockfile": "string" } | null,
  "projectType": "library" | "cli" | "webapp" | "service" | "mobile" | "infra" | "monorepo" | "unknown" | null,
  "buildTool": "string | null",
  "testFramework": "string | null",
  "frameworks": ["string"],
  "hasCI": boolean,
  "hasDocker": boolean,
  "hasInfra": boolean,
  "isMonorepo": boolean,
  "confidence": 0-1,
  "rationale": "string"
}`;

/**
 * LLM-backed repository profiler. Runs after the heuristic scanner and
 * fills in fields the scanner could not determine (missing lockfile,
 * ambiguous project type, framework detection, …). Callers should prefer
 * heuristic detection when present and only fall back to profile output
 * for fields the scanner returned as null/empty.
 */
export class RepoProfiler {
  constructor(private readonly provider: LLMProvider) {}

  async profile(repoContext: RepoContext, fileListing: string): Promise<RepoProfile> {
    const contextJson = JSON.stringify(
      {
        primaryLanguage: repoContext.primaryLanguage,
        languages: repoContext.languages,
        packageManager: repoContext.packageManager,
        ci: repoContext.ci,
        container: repoContext.container,
        infra: repoContext.infra,
        meta: repoContext.meta,
      },
      null,
      2,
    );

    let listing = fileListing;
    const listingBytes = Buffer.byteLength(listing);
    if (listingBytes > MAX_INPUT_BYTES) {
      const truncated = listingBytes - MAX_INPUT_BYTES;
      listing = `${listing.slice(0, MAX_INPUT_BYTES)}\n[...truncated ${truncated} bytes]`;
    }

    const wrappedContext = wrapAsData(contextJson, "heuristic-scan");
    const wrappedListing = wrapAsData(listing, "file-listing");

    const prompt = [
      "Profile this repository using the heuristic scan and file listing below.",
      "",
      "## Heuristic scan",
      wrappedContext,
      "",
      "## File listing and key file snippets",
      wrappedListing,
    ].join("\n");

    const response = await this.provider.generate({
      system: REPO_PROFILER_SYSTEM_PROMPT,
      prompt,
      schema: RepoProfileSchema,
    });

    if (response.parsed) {
      return response.parsed as RepoProfile;
    }
    return parseAndValidate(response.content, RepoProfileSchema);
  }
}
