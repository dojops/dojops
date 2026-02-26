import { LLMProvider, parseAndValidate } from "@dojops/core";
import { MakefileConfig, MakefileConfigSchema } from "./schemas";
import { MakefileDetectionResult } from "./detector";

export async function generateMakefileConfig(
  detection: MakefileDetectionResult,
  targets: string | undefined,
  provider: LLMProvider,
  existingContent?: string,
): Promise<MakefileConfig> {
  const isUpdate = !!existingContent;
  const system = isUpdate
    ? `You are a build automation expert. Update the existing Makefile configuration as structured JSON for a ${detection.projectType} project.
Preserve existing targets and settings. Only add/modify what is requested.
Respond with valid JSON matching the required structure.`
    : `You are a build automation expert. Generate a Makefile configuration as structured JSON for a ${detection.projectType} project.
Include common targets like build, test, lint, clean, and install.
Respond with valid JSON matching the required structure.`;

  const basePrompt = `${isUpdate ? "Update" : "Generate"} a Makefile for a ${detection.projectType} project.
${targets ? `Requested targets: ${targets}` : "Include standard build, test, lint, clean targets."}
Each target should have a name, dependencies, commands, and optionally a description.
Mark all non-file targets as phony.`;
  const prompt = isUpdate
    ? `${basePrompt}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
    : basePrompt;

  const response = await provider.generate({
    system,
    prompt,
    schema: MakefileConfigSchema,
  });

  if (response.parsed) {
    return response.parsed as MakefileConfig;
  }
  return parseAndValidate(response.content, MakefileConfigSchema);
}

export function makefileToString(config: MakefileConfig): string {
  const lines: string[] = [];

  // Variables
  for (const [key, value] of Object.entries(config.variables)) {
    lines.push(`${key} := ${value}`);
  }
  if (Object.keys(config.variables).length > 0) {
    lines.push("");
  }

  // Default target
  lines.push(`.DEFAULT_GOAL := ${config.defaultTarget}`);
  lines.push("");

  // .PHONY declaration
  const phonyTargets = config.targets.filter((t) => t.phony).map((t) => t.name);
  if (phonyTargets.length > 0) {
    lines.push(`.PHONY: ${phonyTargets.join(" ")}`);
    lines.push("");
  }

  // Targets
  for (const target of config.targets) {
    if (target.description) {
      lines.push(`## ${target.description}`);
    }
    const deps = target.deps.length > 0 ? ` ${target.deps.join(" ")}` : "";
    lines.push(`${target.name}:${deps}`);
    for (const cmd of target.commands) {
      lines.push(`\t${cmd}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
