import { LLMProvider, parseAndValidate } from "@dojops/core";
import type { RepoContext } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { TaskGraph, TaskGraphSchema } from "./types";
import { zodSchemaToText } from "./schema-to-text";

export interface DecomposeOptions {
  /** Repo context from .dojops/context.json — used for context-aware file placement */
  repoContext?: RepoContext;
  /** Recent execution history summary for context-aware planning */
  executionMemory?: string;
}

/** Collect CI-related context bullets. */
function collectCIBullets(ctx: RepoContext): string[] {
  if (ctx.ci.length === 0) return [];
  const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
  return [
    `- Existing CI: ${platforms}`,
    ...ctx.ci.map((ci) => `  - ${ci.platform}: ${ci.configPath}`),
  ];
}

/** Collect infra/container/meta bullets. */
function collectInfraBullets(ctx: RepoContext): string[] {
  const bullets: string[] = [];
  if (ctx.container.hasDockerfile) bullets.push("- Has Dockerfile");
  if (ctx.container.hasCompose && ctx.container.composePath) {
    bullets.push(`- Has Compose: ${ctx.container.composePath}`);
  }
  if (ctx.infra.hasTerraform) {
    const providers =
      ctx.infra.tfProviders.length > 0 ? ` (${ctx.infra.tfProviders.join(", ")})` : "";
    bullets.push(`- Has Terraform${providers}`);
  }
  if (ctx.infra.hasKubernetes) bullets.push("- Has Kubernetes manifests");
  if (ctx.infra.hasHelm) bullets.push("- Has Helm charts");
  if (ctx.infra.hasAnsible) bullets.push("- Has Ansible playbooks");
  if (ctx.meta.isMonorepo) bullets.push("- Monorepo structure");
  if (ctx.meta.hasMakefile) bullets.push("- Has Makefile");
  return bullets;
}

/** Collect bullet-point lines describing the detected project context. */
function collectContextBullets(ctx: RepoContext): string[] {
  const bullets: string[] = [];
  if (ctx.primaryLanguage) bullets.push(`- Primary language: ${ctx.primaryLanguage}`);
  if (ctx.packageManager) bullets.push(`- Package manager: ${ctx.packageManager.name}`);
  bullets.push(...collectCIBullets(ctx), ...collectInfraBullets(ctx));
  return bullets;
}

const CONTEXT_INSTRUCTIONS = `
IMPORTANT: Set projectPath to "." (project root) unless the project structure suggests a subdirectory. For existing CI platforms, use matching config paths (e.g. if GitHub Actions already exist at .github/workflows/, place new workflows there).

Tools automatically detect and read existing config files. For update/enhance tasks, just set the correct projectPath/outputPath — the tool handles existing file reading and preserves current configuration.

Canonical output paths by module:
- github-actions: outputPath="." ALWAYS (module handles .github/workflows/ and .github/actions/ paths internally — NEVER set outputPath to a file path like ".github/actions/..." or ".github/workflows/...")
- kubernetes: outputPath="k8s" (Kubernetes manifests go in k8s/ directory)
- helm: outputPath="charts/<chart-name>" (Helm charts under charts/)
- terraform: outputPath="terraform" or "." if .tf files already exist at root
- dockerfile: outputPath="." (Dockerfile at project root)
- docker-compose: outputPath="." (docker-compose.yml at root)
- ansible: outputPath="ansible" (playbooks under ansible/)
- prometheus: outputPath="monitoring" or "." if prometheus.yml exists
- nginx: outputPath="." (nginx.conf at root or /etc/nginx/)
- systemd: outputPath="." (service files at root)
- makefile: outputPath="." (Makefile at root)
- gitlab-ci: outputPath="." (.gitlab-ci.yml at root)
- jenkinsfile: outputPath="." (Jenkinsfile at root, or "jenkins-shared-lib" for shared libraries)`;

export function buildContextSection(ctx: RepoContext): string {
  const parts: string[] = [
    "\n## Project Context (from repo scan)\n",
    "Use this context to choose correct file paths and tool inputs.\n",
    ...collectContextBullets(ctx),
    CONTEXT_INSTRUCTIONS,
  ];
  return parts.join("\n");
}

export async function decompose(
  goal: string,
  provider: LLMProvider,
  tools: DevOpsTool[],
  options?: DecomposeOptions,
): Promise<TaskGraph> {
  // Build tool descriptions, trimming to stay within ~8000 tokens (32000 chars).
  // If the full tool list exceeds the budget, keep only the first N tools that fit.
  const TOKEN_CHAR_BUDGET = 32_000;
  const toolDescriptions = tools.map((t) => {
    const schemaText = zodSchemaToText(t.inputSchema);
    return `### ${t.name}\n${t.description}\nInput fields:\n${schemaText}`;
  });

  let toolList = "";
  let charCount = 0;
  for (const desc of toolDescriptions) {
    const addition = toolList ? "\n\n" + desc : desc;
    if (charCount + addition.length > TOKEN_CHAR_BUDGET) {
      // Token budget exceeded — stop adding tools to avoid oversized prompts
      break;
    }
    toolList += addition;
    charCount += addition.length;
  }

  const contextSection = options?.repoContext ? buildContextSection(options.repoContext) : "";
  const memorySection = options?.executionMemory
    ? `\n## Execution Memory\n\n${options.executionMemory}\n\nUse this history to avoid duplicating work already completed. If a task was recently completed successfully, skip it unless the user explicitly asks to redo it.\n`
    : "";

  const response = await provider.generate({
    system: `You are a DevOps task planner. Break down the user's goal into precise, narrowly-scoped tasks using available tools.

## Available tools

${toolList}
${contextSection}
${memorySection}

## How to write good task prompts

The "prompt" field in each task's input is the MOST IMPORTANT field — it is the detailed instruction that the tool's LLM receives. A vague prompt produces wrong output.

RULES for the "prompt" field:
1. ALWAYS include the EXACT target file path(s) in the prompt. Example: "Create composite action at .github/actions/docker-build/action.yml" or "Update ONLY .github/workflows/reusable-build.yml".
2. Tell the tool to output ONLY the target file(s) — never add "and also update X" in a single task.
3. For update tasks, specify exactly WHAT to change: "Add a new step that calls .github/actions/docker-build composite action. Keep all existing steps unchanged."
4. For create tasks, describe exactly WHAT to create with technical details (inputs, steps, technology).
5. For analysis tasks, the prompt MUST say: "Analyze only. Do NOT generate any files. Return your findings as plain text."

## Task scoping

- ONE task = ONE file operation. Never combine "create file A" + "update file B" in one task.
- Update tasks must say what to KEEP ("keep all existing jobs/steps") and what to CHANGE ("add a new step that...").
- Analysis/check tasks must NOT produce file output — they are read-only.
- Use dependsOn when a task needs another task to be completed first (e.g., "update workflow to use new action" depends on "create the action").
- NEVER create tasks for README.md, documentation, or non-tool-specific files using a DevOps tool. Each tool can ONLY generate files in its own format (e.g., terraform generates .tf files ONLY, github-actions generates YAML workflow/action files ONLY). Documentation tasks should be omitted from the plan entirely.

## Example decomposition

User goal: "Check our CI workflows, create a docker-build composite action, then update reusable-build.yml to use it"

GOOD decomposition:
{
  "goal": "Check CI workflows, create docker-build action, update reusable-build.yml",
  "tasks": [
    {
      "id": "analyze-workflows",
      "tool": "github-actions",
      "description": "Analyze existing GitHub workflows and actions",
      "dependsOn": [],
      "input": {
        "prompt": "Analyze the existing GitHub Actions workflows and composite actions. Do NOT generate any files. Return your analysis findings as plain text including: workflow structure, triggers, jobs, dependencies, and any issues found.",
        "outputPath": "."
      }
    },
    {
      "id": "create-docker-build-action",
      "tool": "github-actions",
      "description": "Create docker-build composite action",
      "dependsOn": ["analyze-workflows"],
      "input": {
        "prompt": "Create ONLY the file .github/actions/docker-build/action.yml — a composite action that builds a Docker image using docker/build-push-action with Buildx, GitHub Container Registry login, and layer caching. Inputs: image-name (required), image-tag (required). Do NOT output any other files.",
        "outputPath": "."
      }
    },
    {
      "id": "update-reusable-build",
      "tool": "github-actions",
      "description": "Update reusable-build.yml to call docker-build action",
      "dependsOn": ["create-docker-build-action"],
      "input": {
        "prompt": "Update ONLY the file .github/workflows/reusable-build.yml. Keep ALL existing steps (checkout, setup-node, lint, test). Add a new job or step that calls the ./.github/actions/docker-build composite action. Do NOT output any other files — only .github/workflows/reusable-build.yml.",
        "outputPath": "."
      }
    }
  ]
}

BAD decomposition (DO NOT DO THIS):
- Vague prompt like "update workflows" → tool doesn't know WHICH file to update
- Combining "create action + update workflow" in one task → overwrites unrelated files
- Missing file paths in prompt → tool generates whatever it wants
- Using $ref:task-id for existingContent → existingContent is always read from disk, never from $ref

## Input field rules

- Each task's "input" object MUST match the tool's input fields exactly. Do not invent fields.
- Do NOT use $ref for "existingContent" — it is always injected from disk automatically.
- Use canonical output paths: github-actions → outputPath="."; kubernetes → "k8s"; helm → "charts/<name>"; terraform → "terraform" (or "."); dockerfile/docker-compose/makefile/gitlab-ci/jenkinsfile → "."; ansible → "ansible"; prometheus → "monitoring".
- outputPath must always be a DIRECTORY, never a file path.

Respond with a JSON object:
{
  "goal": "the original goal",
  "tasks": [
    {
      "id": "unique-id",
      "tool": "tool-name",
      "description": "what this task does",
      "dependsOn": ["id-of-dependency"],
      "input": { "prompt": "detailed instruction with exact file paths", "outputPath": "." }
    }
  ]
}

Do NOT ask follow-up questions. Provide the complete task graph only.`,
    prompt: goal,
    schema: TaskGraphSchema,
  });

  if (response.parsed) {
    return response.parsed as TaskGraph;
  }
  return parseAndValidate(response.content, TaskGraphSchema) as TaskGraph;
}
