import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { NginxInputSchema, NginxInput } from "./schemas";
import { generateNginxConfig, nginxConfigToString } from "./generator";

export class NginxTool extends BaseTool<NginxInput> {
  name = "nginx";
  description = "Generates Nginx reverse proxy configuration with upstream and server blocks";
  inputSchema = NginxInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: NginxInput): Promise<ToolOutput> {
    try {
      const config = await generateNginxConfig(input, this.provider);
      const nginxConf = nginxConfigToString(config);

      return {
        success: true,
        data: {
          config,
          nginxConf,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: NginxInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { nginxConf: string };
    fs.mkdirSync(input.outputPath, { recursive: true });
    fs.writeFileSync(path.join(input.outputPath, "nginx.conf"), data.nginxConf, "utf-8");

    return result;
  }
}
