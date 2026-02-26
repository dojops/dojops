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
import { MakefileInputSchema, MakefileInput } from "./schemas";
import { detectMakefileContext } from "./detector";
import { generateMakefileConfig, makefileToString } from "./generator";

export class MakefileTool extends BaseTool<MakefileInput> {
  name = "makefile";
  description = "Generates Makefiles with build automation targets based on project type";
  inputSchema = MakefileInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: MakefileInput): Promise<ToolOutput> {
    const detection = detectMakefileContext(input.projectPath);

    if (detection.projectType === "unknown") {
      return {
        success: false,
        error: `Could not detect project type at ${input.projectPath}`,
      };
    }

    const existingContent =
      input.existingContent ?? readExistingConfig(path.join(input.projectPath, "Makefile"));
    const isUpdate = !!existingContent;

    try {
      const config = await generateMakefileConfig(
        detection,
        input.targets,
        this.provider,
        existingContent ?? undefined,
      );

      const makefileContent = makefileToString(config);

      return {
        success: true,
        data: {
          detection,
          config,
          makefile: makefileContent,
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

  async execute(input: MakefileInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { makefile: string; isUpdate: boolean };
    const filePath = path.join(input.projectPath, "Makefile");

    if (data.isUpdate) {
      backupFile(filePath);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    atomicWriteFileSync(filePath, data.makefile);

    const filesWritten = [filePath];
    return { ...result, filesWritten, filesModified: data.isUpdate ? [filePath] : [] };
  }
}
