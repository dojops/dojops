import * as fs from "fs";
import * as path from "path";
import { BaseTool, ToolOutput } from "@dojops/sdk";
import { LLMProvider } from "@dojops/core";
import { HelmInputSchema, HelmInput } from "./schemas";
import {
  generateHelmValues,
  generateChartYaml,
  valuesToYaml,
  generateDeploymentTemplate,
  generateServiceTemplate,
  generateHelpersTemplate,
} from "./generator";

export class HelmTool extends BaseTool<HelmInput> {
  name = "helm";
  description = "Generates Helm chart scaffolding with deployment, service, and values";
  inputSchema = HelmInputSchema;

  constructor(private provider: LLMProvider) {
    super();
  }

  async generate(input: HelmInput): Promise<ToolOutput> {
    try {
      const chartResponse = await generateHelmValues(input, this.provider);
      const chartYaml = generateChartYaml(input);
      const valuesYaml = valuesToYaml(chartResponse.values);
      const deploymentTpl = generateDeploymentTemplate(input.chartName);
      const serviceTpl = generateServiceTemplate(input.chartName);
      const helpersTpl = generateHelpersTemplate(input.chartName);

      return {
        success: true,
        data: {
          chartYaml,
          valuesYaml,
          templates: {
            deployment: deploymentTpl,
            service: serviceTpl,
            helpers: helpersTpl,
          },
          notes: chartResponse.notes,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: HelmInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as {
      chartYaml: string;
      valuesYaml: string;
      templates: { deployment: string; service: string; helpers: string };
    };

    const chartDir = path.join(input.outputPath, input.chartName);
    const templatesDir = path.join(chartDir, "templates");
    fs.mkdirSync(templatesDir, { recursive: true });

    fs.writeFileSync(path.join(chartDir, "Chart.yaml"), data.chartYaml, "utf-8");
    fs.writeFileSync(path.join(chartDir, "values.yaml"), data.valuesYaml, "utf-8");
    fs.writeFileSync(
      path.join(templatesDir, "deployment.yaml"),
      data.templates.deployment,
      "utf-8",
    );
    fs.writeFileSync(path.join(templatesDir, "service.yaml"), data.templates.service, "utf-8");
    fs.writeFileSync(path.join(templatesDir, "_helpers.tpl"), data.templates.helpers, "utf-8");

    return result;
  }
}
