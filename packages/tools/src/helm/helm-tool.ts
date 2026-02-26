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
    const existingContent =
      input.existingContent ??
      readExistingConfig(path.join(input.outputPath, input.chartName, "values.yaml"));
    const isUpdate = !!existingContent;

    try {
      const chartResponse = await generateHelmValues(
        input,
        this.provider,
        existingContent ?? undefined,
      );
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

  async execute(input: HelmInput): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as {
      chartYaml: string;
      valuesYaml: string;
      templates: { deployment: string; service: string; helpers: string };
      isUpdate: boolean;
    };

    const chartDir = path.join(input.outputPath, input.chartName);
    const templatesDir = path.join(chartDir, "templates");

    if (data.isUpdate) {
      backupFile(path.join(chartDir, "Chart.yaml"));
      backupFile(path.join(chartDir, "values.yaml"));
      backupFile(path.join(templatesDir, "deployment.yaml"));
      backupFile(path.join(templatesDir, "service.yaml"));
      backupFile(path.join(templatesDir, "_helpers.tpl"));
    }

    fs.mkdirSync(templatesDir, { recursive: true });

    const chartYamlPath = path.join(chartDir, "Chart.yaml");
    const valuesYamlPath = path.join(chartDir, "values.yaml");
    const deploymentPath = path.join(templatesDir, "deployment.yaml");
    const servicePath = path.join(templatesDir, "service.yaml");
    const helpersPath = path.join(templatesDir, "_helpers.tpl");

    atomicWriteFileSync(chartYamlPath, data.chartYaml);
    atomicWriteFileSync(valuesYamlPath, data.valuesYaml);
    atomicWriteFileSync(deploymentPath, data.templates.deployment);
    atomicWriteFileSync(servicePath, data.templates.service);
    atomicWriteFileSync(helpersPath, data.templates.helpers);

    const filesWritten = [chartYamlPath, valuesYamlPath, deploymentPath, servicePath, helpersPath];
    return { ...result, filesWritten, filesModified: data.isUpdate ? filesWritten : [] };
  }
}
