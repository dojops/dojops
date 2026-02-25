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
import { PluginTool } from "./plugin-tool";
import { discoverPlugins } from "./plugin-loader";
import { loadPluginPolicy, isPluginAllowed } from "./policy";

export * from "./types";
export * from "./registry";
export * from "./plugin-tool";
export * from "./plugin-loader";
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
 * plus any valid, policy-allowed plugin tools discovered from disk.
 *
 * This fixes the previous bug where createTools() only instantiated 5 of 12 tools.
 */
export function createToolRegistry(provider: LLMProvider, projectPath?: string): ToolRegistry {
  const builtInTools = createBuiltInTools(provider);

  // Discover plugin manifests
  const pluginEntries = discoverPlugins(projectPath);

  // Apply policy filter
  const policy = loadPluginPolicy(projectPath);
  const allowedEntries = pluginEntries.filter((entry) =>
    isPluginAllowed(entry.manifest.name, policy),
  );

  // Create PluginTool instances
  const pluginTools: PluginTool[] = allowedEntries.map(
    (entry) =>
      new PluginTool(
        entry.manifest,
        provider,
        entry.pluginDir,
        entry.source,
        entry.inputSchemaRaw,
        entry.outputSchemaRaw,
      ),
  );

  return new ToolRegistry(builtInTools, pluginTools);
}
