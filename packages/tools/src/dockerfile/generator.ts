import { LLMProvider } from "@dojops/core";
import { DockerfileConfig, DockerfileConfigSchema } from "./schemas";
import { DockerDetectionResult } from "./detector";

export async function generateDockerfileConfig(
  detection: DockerDetectionResult,
  baseImage: string | undefined,
  provider: LLMProvider,
): Promise<DockerfileConfig> {
  const response = await provider.generate({
    system: `You are a Docker multi-stage build expert. Generate a Dockerfile configuration as structured JSON.
Project type: ${detection.projectType}.
${baseImage ? `Use base image: ${baseImage}` : "Choose an appropriate base image for the project type."}
${detection.hasLockfile ? "Lockfile detected — copy it separately for better caching." : ""}
Use multi-stage builds where appropriate for smaller final images.
Respond with valid JSON matching the required structure.`,
    prompt: `Generate a multi-stage Dockerfile for a ${detection.projectType} project.
Entry file: ${detection.entryFile || "auto-detect"}.
Include: dependency install stage, build stage (if applicable), and production stage.
Also include common .dockerignore patterns for ${detection.projectType}.`,
    schema: DockerfileConfigSchema,
  });

  return response.parsed as DockerfileConfig;
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
