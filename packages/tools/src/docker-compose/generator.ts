import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { ComposeConfig, ComposeConfigSchema } from "./schemas";
import { ComposeDetectionResult } from "./detector";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

export async function generateComposeConfig(
  detection: ComposeDetectionResult,
  services: string,
  networkMode: string,
  provider: LLMProvider,
  existingContent?: string,
): Promise<ComposeConfig> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a Docker Compose expert. Update the existing docker-compose.yml configuration.
Preserve existing services and settings. Only add/modify what is requested.
Project type: ${detection.projectType}.
Network mode: ${networkMode}.
${detection.hasDockerfile ? "The project already has a Dockerfile — use build context instead of image for the main service." : ""}
Respond with valid JSON matching the required structure.`
    : `You are a Docker Compose expert. Generate a docker-compose.yml configuration.
Project type: ${detection.projectType}.
Network mode: ${networkMode}.
${detection.hasDockerfile ? "The project already has a Dockerfile — use build context instead of image for the main service." : ""}
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a Docker Compose configuration for: ${services}
Include appropriate ports, environment variables, volumes, and depends_on relationships.
Use restart policy "unless-stopped" for production services.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: ComposeConfigSchema,
  });

  if (response.parsed) {
    return response.parsed as ComposeConfig;
  }
  return parseAndValidate(response.content, ComposeConfigSchema);
}

export function composeToYaml(config: ComposeConfig): string {
  return yaml.dump(config, YAML_DUMP_OPTIONS);
}
