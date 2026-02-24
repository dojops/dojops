import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
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

    try {
      const config = await generateMakefileConfig(detection, input.targets, this.provider);

      const makefileContent = makefileToString(config);

      return {
        success: true,
        data: {
          detection,
          config,
          makefile: makefileContent,
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

    const data = result.data as { makefile: string };
    fs.writeFileSync(path.join(input.projectPath, "Makefile"), data.makefile, "utf-8");

    return result;
  }
}
