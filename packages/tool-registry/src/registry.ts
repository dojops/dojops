import { DevOpsTool } from "@dojops/sdk";
import { PluginTool } from "./plugin-tool";

/**
 * Central registry combining built-in and plugin tools.
 * Provides a unified getAll() / get(name) interface for Planner, Executor, CLI, and API.
 */
export class ToolRegistry {
  private toolMap: Map<string, DevOpsTool>;
  private builtIn: DevOpsTool[];
  private plugins: PluginTool[];

  constructor(builtInTools: DevOpsTool[], pluginTools: PluginTool[]) {
    this.builtIn = builtInTools;
    this.plugins = pluginTools;
    this.toolMap = new Map();

    // Built-in tools first
    for (const tool of builtInTools) {
      this.toolMap.set(tool.name, tool);
    }

    // Plugin tools can override built-in tools (project plugins win)
    for (const plugin of pluginTools) {
      this.toolMap.set(plugin.name, plugin);
    }
  }

  /** All tools: built-in + plugins, deduplicated by name (plugins override). */
  getAll(): DevOpsTool[] {
    return Array.from(this.toolMap.values());
  }

  /** Look up a tool by name. */
  get(name: string): DevOpsTool | undefined {
    return this.toolMap.get(name);
  }

  /** Check if a tool exists by name. */
  has(name: string): boolean {
    return this.toolMap.has(name);
  }

  /** Get only built-in tools. */
  getBuiltIn(): DevOpsTool[] {
    return [...this.builtIn];
  }

  /** Get only plugin tools. */
  getPlugins(): PluginTool[] {
    return [...this.plugins];
  }

  /** Extract plugin metadata for a tool by name. */
  getToolMetadata(name: string):
    | {
        toolType: "built-in" | "plugin";
        pluginVersion?: string;
        pluginHash?: string;
        pluginSource?: string;
        systemPromptHash?: string;
      }
    | undefined {
    const tool = this.toolMap.get(name);
    if (!tool) return undefined;

    const plugin = this.plugins.find((p) => p.name === name);
    if (plugin) {
      return {
        toolType: "plugin",
        pluginVersion: plugin.source.pluginVersion,
        pluginHash: plugin.source.pluginHash,
        pluginSource: plugin.source.location,
        systemPromptHash: plugin.systemPromptHash,
      };
    }

    return { toolType: "built-in" };
  }

  /** Total count of unique tools. */
  get size(): number {
    return this.toolMap.size;
  }
}
