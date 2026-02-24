import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { ComposeConfig, ComposeConfigSchema } from "./schemas";
import { ComposeDetectionResult } from "./detector";

export async function generateComposeConfig(
  detection: ComposeDetectionResult,
  services: string,
  networkMode: string,
  provider: LLMProvider,
): Promise<ComposeConfig> {
  const response = await provider.generate({
    system: `You are a Docker Compose expert. Generate a docker-compose.yml configuration.
Project type: ${detection.projectType}.
Network mode: ${networkMode}.
${detection.hasDockerfile ? "The project already has a Dockerfile — use build context instead of image for the main service." : ""}
Respond with valid JSON matching the required structure.`,
    prompt: `Generate a Docker Compose configuration for: ${services}
Include appropriate ports, environment variables, volumes, and depends_on relationships.
Use restart policy "unless-stopped" for production services.`,
    schema: ComposeConfigSchema,
  });

  return response.parsed as ComposeConfig;
}

export function composeToYaml(config: ComposeConfig): string {
  return yaml.dump(config, { lineWidth: 120, noRefs: true });
}
