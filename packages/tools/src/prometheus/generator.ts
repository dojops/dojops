import { LLMProvider } from "@dojops/core";
import * as yaml from "js-yaml";
import { PrometheusResponse, PrometheusResponseSchema, PrometheusInput } from "./schemas";

export async function generatePrometheusConfig(
  input: PrometheusInput,
  provider: LLMProvider,
): Promise<PrometheusResponse> {
  const response = await provider.generate({
    system: `You are a Prometheus monitoring expert. Generate Prometheus scrape configuration and alert rules as structured JSON.
Respond with valid JSON matching the required structure.`,
    prompt: `Generate a Prometheus configuration for the following targets: ${input.targets.join(", ")}
Scrape interval: ${input.scrapeInterval}
${input.alertRules ? `Alert rules needed: ${input.alertRules}` : "No alert rules needed — leave alertGroups as an empty array."}
Include appropriate job names and labels for each target.`,
    schema: PrometheusResponseSchema,
  });

  return response.parsed as PrometheusResponse;
}

export function prometheusToYaml(config: PrometheusResponse): string {
  const doc: Record<string, unknown> = {
    global: config.global,
  };

  if (config.alertGroups.length > 0) {
    doc.rule_files = ["alert-rules.yml"];
  }

  doc.scrape_configs = config.scrape_configs;

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

export function alertRulesToYaml(config: PrometheusResponse): string | null {
  if (config.alertGroups.length === 0) return null;

  const doc = {
    groups: config.alertGroups.map((group) => ({
      name: group.name,
      rules: group.rules,
    })),
  };

  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}
