import { LLMProvider, parseAndValidate } from "@dojops/core";
import type { RepoContext } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { TaskGraph, TaskGraphSchema } from "./types";
import { zodSchemaToText } from "./schema-to-text";

export interface DecomposeOptions {
  /** Repo context from .dojops/context.json — used for context-aware file placement */
  repoContext?: RepoContext;
}

/** Collect bullet-point lines describing the detected project context. */
function collectContextBullets(ctx: RepoContext): string[] {
  const bullets: string[] = [];
  if (ctx.primaryLanguage) bullets.push(`- Primary language: ${ctx.primaryLanguage}`);
  if (ctx.packageManager) bullets.push(`- Package manager: ${ctx.packageManager.name}`);
  if (ctx.ci.length > 0) {
    const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
    bullets.push(`- Existing CI: ${platforms}`);
    for (const ci of ctx.ci) bullets.push(`  - ${ci.platform}: ${ci.configPath}`);
  }
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

const CONTEXT_INSTRUCTIONS = `
IMPORTANT: Set projectPath to "." (project root) unless the project structure suggests a subdirectory. For existing CI platforms, use matching config paths (e.g. if GitHub Actions already exist at .github/workflows/, place new workflows there).

Tools automatically detect and read existing config files. For update/enhance tasks, just set the correct projectPath/outputPath — the tool handles existing file reading and preserves current configuration.

Canonical output paths by tool:
- github-actions: projectPath="." (tool auto-creates .github/workflows/)
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
- gitlab-ci: outputPath="." (.gitlab-ci.yml at root)`;

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

  const response = await provider.generate({
    system: `You are a DevOps task planner. Break down goals into tasks using available tools.

Available tools:

${toolList}
${contextSection}

IMPORTANT: Each task's "input" object MUST match the tool's input fields exactly. Use the correct field names, types, and provide all required fields. Do not invent fields that are not listed.

For tools that only accept a "prompt" input, provide a detailed natural-language description of what configuration to generate. Include specifics like language/runtime, versions, deployment targets, and any special requirements. The tool handles technology-specific details internally.

Use canonical output paths: github-actions → projectPath="."; kubernetes → outputPath="k8s"; helm → outputPath="charts/<name>"; terraform → outputPath="terraform" (or "." if .tf already at root); dockerfile/docker-compose/makefile/gitlab-ci → outputPath="."; ansible → outputPath="ansible"; prometheus → outputPath="monitoring".

Respond with a JSON object matching this structure:
{
  "goal": "the original goal",
  "tasks": [
    {
      "id": "unique-id",
      "tool": "tool-name",
      "description": "what this task does",
      "dependsOn": ["id-of-dependency"],
      "input": { "key": "value or $ref:task-id for output from another task" }
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
