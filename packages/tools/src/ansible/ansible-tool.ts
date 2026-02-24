import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { AnsibleInputSchema, AnsibleInput } from "./schemas";
import { generateAnsiblePlaybook, playbookToYaml } from "./generator";

export class AnsibleTool extends BaseTool<AnsibleInput> {
  name = "ansible";
  description = "Generates Ansible playbooks for server configuration and provisioning";
  inputSchema = AnsibleInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: AnsibleInput): Promise<ToolOutput> {
    try {
      const playbook = await generateAnsiblePlaybook(input, this.provider);
      const yamlContent = playbookToYaml(playbook, input);

      return {
        success: true,
        data: {
          playbook,
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

  async execute(input: AnsibleInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { yaml: string };
    fs.mkdirSync(input.outputPath, { recursive: true });
    fs.writeFileSync(path.join(input.outputPath, `${input.playbookName}.yml`), data.yaml, "utf-8");

    return result;
  }
}
