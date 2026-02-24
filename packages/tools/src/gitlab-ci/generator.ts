import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { GitLabCIConfig, GitLabCIConfigSchema } from "./schemas";
import { GitLabProjectTypeResult } from "./detector";

export async function generateGitLabCI(
  projectType: GitLabProjectTypeResult,
  defaultBranch: string,
  nodeVersion: string,
  provider: LLMProvider,
): Promise<GitLabCIConfig> {
  const response = await provider.generate({
    system: `You are a GitLab CI/CD expert. Generate a .gitlab-ci.yml configuration for a ${projectType.type} project.
The pipeline should include stages for linting, testing, and building.
Respond with valid JSON matching the required structure.`,
    prompt: `Generate a GitLab CI pipeline for a ${projectType.type} project.
Default branch: ${defaultBranch}
${projectType.type === "node" ? `Node version: ${nodeVersion}` : ""}
Include stages: lint, test, build. Each job should have stage, image, script, and optionally cache/artifacts.`,
    schema: GitLabCIConfigSchema,
  });

  return response.parsed as GitLabCIConfig;
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

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}
