import { LLMProvider, parseAndValidate } from "@dojops/core";
import type { RepoContext } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { TaskGraph, TaskGraphSchema } from "./types";
import { zodSchemaToText } from "./schema-to-text";

export interface DecomposeOptions {
  /** Repo context from .dojops/context.json — used for context-aware file placement */
  repoContext?: RepoContext;
}

function buildContextSection(ctx: RepoContext): string {
  const parts: string[] = [];
  parts.push("\n## Project Context (from repo scan)\n");
  parts.push("Use this context to choose correct file paths and tool inputs.\n");

  if (ctx.primaryLanguage) {
    parts.push(`- Primary language: ${ctx.primaryLanguage}`);
  }
  if (ctx.packageManager) {
    parts.push(`- Package manager: ${ctx.packageManager.name}`);
  }
  if (ctx.ci.length > 0) {
    const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
    parts.push(`- Existing CI: ${platforms}`);
    for (const ci of ctx.ci) {
      parts.push(`  - ${ci.platform}: ${ci.configPath}`);
    }
  }
  if (ctx.container.hasDockerfile) {
    parts.push("- Has Dockerfile");
  }
  if (ctx.container.hasCompose && ctx.container.composePath) {
    parts.push(`- Has Compose: ${ctx.container.composePath}`);
  }
  if (ctx.infra.hasTerraform) {
    const providers =
      ctx.infra.tfProviders.length > 0 ? ` (${ctx.infra.tfProviders.join(", ")})` : "";
    parts.push(`- Has Terraform${providers}`);
  }
  if (ctx.infra.hasKubernetes) parts.push("- Has Kubernetes manifests");
  if (ctx.infra.hasHelm) parts.push("- Has Helm charts");
  if (ctx.infra.hasAnsible) parts.push("- Has Ansible playbooks");
  if (ctx.meta.isMonorepo) parts.push("- Monorepo structure");
  if (ctx.meta.hasMakefile) parts.push("- Has Makefile");

  parts.push(
    `\nIMPORTANT: Set projectPath to "." (project root) unless the project structure suggests a subdirectory. For existing CI platforms, use matching config paths (e.g. if GitHub Actions already exist at .github/workflows/, place new workflows there).`,
  );
  parts.push(
    `\nTools automatically detect and read existing config files. For update/enhance tasks, just set the correct projectPath/outputPath — the tool handles existing file reading and preserves current configuration.`,
  );

  return parts.join("\n");
}

export async function decompose(
  goal: string,
  provider: LLMProvider,
  tools: DevOpsTool[],
  options?: DecomposeOptions,
): Promise<TaskGraph> {
  const toolList = tools
    .map((t) => {
      const schemaText = zodSchemaToText(t.inputSchema);
      return `### ${t.name}\n${t.description}\nInput fields:\n${schemaText}`;
    })
    .join("\n\n");

  const contextSection = options?.repoContext ? buildContextSection(options.repoContext) : "";

  const response = await provider.generate({
    system: `You are a DevOps task planner. Break down goals into tasks using available tools.

Available tools:

${toolList}
${contextSection}

IMPORTANT: Each task's "input" object MUST match the tool's input fields exactly. Use the correct field names, types, and provide all required fields. Do not invent fields that are not listed.

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
