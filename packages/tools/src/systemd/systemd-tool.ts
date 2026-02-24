import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { SystemdInputSchema, SystemdInput } from "./schemas";
import { generateSystemdConfig, systemdConfigToString } from "./generator";

export class SystemdTool extends BaseTool<SystemdInput> {
  name = "systemd";
  description = "Generates systemd service unit files for Linux daemon management";
  inputSchema = SystemdInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: SystemdInput): Promise<ToolOutput> {
    try {
      const config = await generateSystemdConfig(input, this.provider);
      const unitFile = systemdConfigToString(config);

      return {
        success: true,
        data: {
          config,
          unitFile,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: SystemdInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { unitFile: string };
    fs.mkdirSync(input.outputPath, { recursive: true });
    fs.writeFileSync(
      path.join(input.outputPath, `${input.serviceName}.service`),
      data.unitFile,
      "utf-8",
    );

    return result;
  }
}
