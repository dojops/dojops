import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { GitLabCIConfig, GitLabCIConfigSchema } from "./schemas";
import { GitLabProjectTypeResult } from "./detector";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

export async function generateGitLabCI(
  projectType: GitLabProjectTypeResult,
  defaultBranch: string,
  nodeVersion: string,
  provider: LLMProvider,
  existingContent?: string,
): Promise<GitLabCIConfig> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a GitLab CI/CD expert. Update the existing .gitlab-ci.yml configuration for a ${projectType.type} project.
Preserve existing stages and jobs. Only add/modify what is requested.
Respond with valid JSON matching the required structure.`
    : `You are a GitLab CI/CD expert. Generate a .gitlab-ci.yml configuration for a ${projectType.type} project.
The pipeline should include stages for linting, testing, and building.
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a GitLab CI pipeline for a ${projectType.type} project.
Default branch: ${defaultBranch}
${projectType.type === "node" ? `Node version: ${nodeVersion}` : ""}
Include stages: lint, test, build. Each job should have stage, image, script, and optionally cache/artifacts.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: GitLabCIConfigSchema,
  });

  if (response.parsed) {
    return response.parsed as GitLabCIConfig;
  }
  return parseAndValidate(response.content, GitLabCIConfigSchema);
}

export function gitlabCIToYaml(config: GitLabCIConfig): string {
  const doc: Record<string, unknown> = {
    stages: config.stages,
  };

  const variables = config.variables as Record<string, string>;
  if (Object.keys(variables).length > 0) {
    doc.variables = variables;
  }

  const jobs = config.jobs as Record<string, Record<string, unknown>>;
  for (const [jobName, job] of Object.entries(jobs)) {
    doc[jobName] = { ...job };
  }

  return yaml.dump(doc, YAML_DUMP_OPTIONS);
}
