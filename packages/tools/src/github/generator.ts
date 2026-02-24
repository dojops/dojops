import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { LLMWorkflowResponseSchema, Workflow } from "./schemas";
import { ProjectTypeResult } from "./detector";

export async function generateWorkflow(
  projectType: ProjectTypeResult,
  defaultBranch: string,
  nodeVersion: string,
  provider: LLMProvider,
): Promise<Workflow> {
  const response = await provider.generate({
    system: `You are a CI/CD expert. Generate a GitHub Actions workflow for a ${projectType.type} project.
The workflow should include linting, testing, and building steps appropriate for the project type.
Respond with valid JSON matching the GitHub Actions workflow structure.`,
    prompt: `Generate a CI workflow for a ${projectType.type} project.
Default branch: ${defaultBranch}
${projectType.type === "node" ? `Node version: ${nodeVersion}` : ""}
Include: checkout, setup, install dependencies, lint, test, build.`,
    schema: LLMWorkflowResponseSchema,
  });

  return response.parsed as Workflow;
}

export function workflowToYaml(workflow: Workflow): string {
  return yaml.dump(workflow, { lineWidth: 120, noRefs: true });
}
