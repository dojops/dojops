import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { LLMWorkflowResponseSchema, Workflow } from "./schemas";
import { ProjectTypeResult } from "./detector";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

const GITHUB_KEY_ORDER = ["name", "on", "permissions", "env", "jobs"];

function githubSortKeys(a: string, b: string): number {
  const ai = GITHUB_KEY_ORDER.indexOf(a);
  const bi = GITHUB_KEY_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b);
}

export async function generateWorkflow(
  projectType: ProjectTypeResult,
  defaultBranch: string,
  nodeVersion: string,
  provider: LLMProvider,
  existingContent?: string,
): Promise<Workflow> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a CI/CD expert. Update the existing GitHub Actions workflow for a ${projectType.type} project.
Preserve existing structure and settings. Only add/modify what is requested.
Respond with valid JSON matching the GitHub Actions workflow structure.`
    : `You are a CI/CD expert. Generate a GitHub Actions workflow for a ${projectType.type} project.
The workflow should include linting, testing, and building steps appropriate for the project type.
Respond with valid JSON matching the GitHub Actions workflow structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a CI workflow for a ${projectType.type} project.
Default branch: ${defaultBranch}
${projectType.type === "node" ? `Node version: ${nodeVersion}` : ""}
Include: checkout, setup, install dependencies, lint, test, build.`;

  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: LLMWorkflowResponseSchema,
  });

  if (response.parsed) {
    return response.parsed as Workflow;
  }
  return parseAndValidate(response.content, LLMWorkflowResponseSchema);
}

export function workflowToYaml(workflow: Workflow): string {
  return yaml.dump(workflow, { ...YAML_DUMP_OPTIONS, sortKeys: githubSortKeys });
}
