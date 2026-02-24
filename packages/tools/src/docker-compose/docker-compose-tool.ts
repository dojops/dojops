import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { DockerComposeInputSchema, DockerComposeInput } from "./schemas";
import { detectComposeContext } from "./detector";
import { generateComposeConfig, composeToYaml } from "./generator";

export class DockerComposeTool extends BaseTool<DockerComposeInput> {
  name = "docker-compose";
  description = "Generates Docker Compose configuration for multi-container applications";
  inputSchema = DockerComposeInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: DockerComposeInput): Promise<ToolOutput> {
    const detection = detectComposeContext(input.projectPath);

    try {
      const config = await generateComposeConfig(
        detection,
        input.services,
        input.networkMode,
        this.provider,
      );

      const yamlContent = composeToYaml(config);

      return {
        success: true,
        data: {
          detection,
          config,
          yaml: yamlContent,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: DockerComposeInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string };
    fs.writeFileSync(path.join(input.projectPath, "docker-compose.yml"), data.yaml, "utf-8");

    return result;
  }
}
