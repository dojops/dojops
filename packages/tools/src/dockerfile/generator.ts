import { LLMProvider, parseAndValidate } from "@dojops/core";
import { DockerfileConfig, DockerfileConfigSchema } from "./schemas";
import { DockerDetectionResult } from "./detector";

export async function generateDockerfileConfig(
  detection: DockerDetectionResult,
  baseImage: string | undefined,
  provider: LLMProvider,
  existingContent?: string,
): Promise<DockerfileConfig> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a Docker multi-stage build expert. Update the existing Dockerfile configuration as structured JSON.
Preserve existing stages and settings. Only add/modify what is requested.
Project type: ${detection.projectType}.
${baseImage ? `Use base image: ${baseImage}` : "Keep the existing base image unless a change is requested."}
${detection.hasLockfile ? "Lockfile detected — copy it separately for better caching." : ""}
Respond with valid JSON matching the required structure.`
    : `You are a Docker multi-stage build expert. Generate a Dockerfile configuration as structured JSON.
Project type: ${detection.projectType}.
${baseImage ? `Use base image: ${baseImage}` : "Choose an appropriate base image for the project type."}
${detection.hasLockfile ? "Lockfile detected — copy it separately for better caching." : ""}
Use multi-stage builds where appropriate for smaller final images.
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a multi-stage Dockerfile for a ${detection.projectType} project.
Entry file: ${detection.entryFile || "auto-detect"}.
Include: dependency install stage, build stage (if applicable), and production stage.
Also include common .dockerignore patterns for ${detection.projectType}.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: DockerfileConfigSchema,
  });

  if (response.parsed) {
    return response.parsed as DockerfileConfig;
  }
  return parseAndValidate(response.content, DockerfileConfigSchema);
}

export function dockerfileToString(config: DockerfileConfig): string {
  const lines: string[] = [];

  for (let i = 0; i < config.stages.length; i++) {
    const stage = config.stages[i];
    if (i > 0) lines.push("");
    lines.push(`FROM ${stage.from} AS ${stage.name}`);
    for (const cmd of stage.commands) {
      lines.push(cmd);
    }
  }

  return lines.join("\n") + "\n";
}

export function dockerignoreToString(patterns: string[]): string {
  return patterns.join("\n") + "\n";
}
