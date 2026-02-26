import * as fs from "fs";
import * as path from "path";
import {
  BaseTool,
  ToolOutput,
  readExistingConfig,
  backupFile,
  atomicWriteFileSync,
} from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { DockerComposeInputSchema, DockerComposeInput } from "./schemas";
import { detectComposeContext } from "./detector";
import { generateComposeConfig, composeToYaml } from "./generator";

const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

export class DockerComposeTool extends BaseTool<DockerComposeInput> {
  name = "docker-compose";
  description = "Generates Docker Compose configuration for multi-container applications";
  inputSchema = DockerComposeInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: DockerComposeInput): Promise<ToolOutput> {
    const detection = detectComposeContext(input.projectPath);

    let existingContent = input.existingContent ?? null;
    if (!existingContent) {
      for (const f of COMPOSE_FILES) {
        existingContent = readExistingConfig(path.join(input.projectPath, f));
        if (existingContent) break;
      }
    }
    const isUpdate = !!existingContent;

    try {
      const config = await generateComposeConfig(
        detection,
        input.services,
        input.networkMode,
        this.provider,
        existingContent ?? undefined,
      );

      const yamlContent = composeToYaml(config);

      return {
        success: true,
        data: {
          detection,
          config,
          yaml: yamlContent,
          isUpdate,
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

    const data = result.data as { yaml: string; isUpdate: boolean };
    const filePath = path.join(input.projectPath, "docker-compose.yml");

    if (data.isUpdate) {
      backupFile(filePath);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    atomicWriteFileSync(filePath, data.yaml);

    const filesWritten = [filePath];
    return { ...result, filesWritten, filesModified: data.isUpdate ? [filePath] : [] };
  }
}
