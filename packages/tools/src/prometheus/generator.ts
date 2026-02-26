import { LLMProvider, parseAndValidate } from "@dojops/core";
import * as yaml from "js-yaml";
import { PrometheusResponse, PrometheusResponseSchema, PrometheusInput } from "./schemas";
import { YAML_DUMP_OPTIONS } from "../yaml-options";

export async function generatePrometheusConfig(
  input: PrometheusInput,
  provider: LLMProvider,
  existingContent?: string,
): Promise<PrometheusResponse> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a Prometheus monitoring expert. Update the existing Prometheus scrape configuration and alert rules as structured JSON.
Preserve existing scrape configs and settings. Only add/modify what is requested.
Respond with valid JSON matching the required structure.`
    : `You are a Prometheus monitoring expert. Generate Prometheus scrape configuration and alert rules as structured JSON.
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a Prometheus configuration for the following targets: ${input.targets.join(", ")}
Scrape interval: ${input.scrapeInterval}
${input.alertRules ? `Alert rules needed: ${input.alertRules}` : "No alert rules needed — leave alertGroups as an empty array."}
Include appropriate job names and labels for each target.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: PrometheusResponseSchema,
  });

  if (response.parsed) {
    return response.parsed as PrometheusResponse;
  }
  return parseAndValidate(response.content, PrometheusResponseSchema);
}

export function prometheusToYaml(config: PrometheusResponse): string {
  const doc: Record<string, unknown> = {
    global: config.global,
  };

  if (config.alertGroups.length > 0) {
    doc.rule_files = ["alert-rules.yml"];
  }

  doc.scrape_configs = config.scrape_configs;

  return yaml.dump(doc, YAML_DUMP_OPTIONS);
}

export function alertRulesToYaml(config: PrometheusResponse): string | null {
  if (config.alertGroups.length === 0) return null;

  const doc = {
    groups: config.alertGroups.map((group) => ({
      name: group.name,
      rules: group.rules,
    })),
  };

  return yaml.dump(doc, YAML_DUMP_OPTIONS);
}
