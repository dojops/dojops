import { LLMProvider } from "@dojops/core";
import {
  GitHubActionsTool,
  TerraformTool,
  KubernetesTool,
  HelmTool,
  AnsibleTool,
  DockerComposeTool,
  DockerfileTool,
  NginxTool,
  MakefileTool,
  GitLabCITool,
  PrometheusTool,
  SystemdTool,
} from "@dojops/tools";
import { ToolRegistry } from "./registry";
import { CustomTool } from "./custom-tool";
import { discoverTools } from "./tool-loader";
import { loadToolPolicy, isToolAllowed } from "./policy";

export * from "./types";
export * from "./registry";
export * from "./custom-tool";
export * from "./tool-loader";
export * from "./policy";
export * from "./json-schema-to-zod";
export * from "./serializers";
export * from "./manifest-schema";
export * from "./agent-parser";
export * from "./agent-loader";
export * from "./agent-schema";

/**
 * Creates all 12 built-in tool instances.
 */
export function createBuiltInTools(provider: LLMProvider) {
  return [
    new GitHubActionsTool(provider),
    new TerraformTool(provider),
    new KubernetesTool(provider),
    new HelmTool(provider),
    new AnsibleTool(provider),
    new DockerComposeTool(provider),
    new DockerfileTool(provider),
    new NginxTool(provider),
    new MakefileTool(provider),
    new GitLabCITool(provider),
    new PrometheusTool(provider),
    new SystemdTool(provider),
  ];
}

/**
 * Convenience factory: builds a ToolRegistry with all 12 built-in tools
 * plus any valid, policy-allowed custom tools discovered from disk.
 */
export function createToolRegistry(provider: LLMProvider, projectPath?: string): ToolRegistry {
  const builtInTools = createBuiltInTools(provider);

  // Discover tool manifests
  const toolEntries = discoverTools(projectPath);

  // Apply policy filter
  const policy = loadToolPolicy(projectPath);
  const allowedEntries = toolEntries.filter((entry) => isToolAllowed(entry.manifest.name, policy));

  // Create CustomTool instances
  const customTools: CustomTool[] = allowedEntries.map(
    (entry) =>
      new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
        entry.outputSchemaRaw,
      ),
  );

  return new ToolRegistry(builtInTools, customTools);
}
