import { DevOpsTool } from "@dojops/sdk";
import { CustomTool } from "./custom-tool";

/**
 * Central registry combining built-in and custom tools.
 * Provides a unified getAll() / get(name) interface for Planner, Executor, CLI, and API.
 */
export class ToolRegistry {
  private toolMap: Map<string, DevOpsTool>;
  private builtIn: DevOpsTool[];
  private customTools: CustomTool[];

  constructor(builtInTools: DevOpsTool[], customTools: CustomTool[]) {
    this.builtIn = builtInTools;
    this.customTools = customTools;
    this.toolMap = new Map();

    // Built-in tools first
    for (const tool of builtInTools) {
      this.toolMap.set(tool.name, tool);
    }

    // Custom tools can override built-in tools (project tools win)
    for (const custom of customTools) {
      this.toolMap.set(custom.name, custom);
    }
  }

  /** All tools: built-in + custom, deduplicated by name (custom tools override). */
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

  /** Get only custom tools. */
  getCustomTools(): CustomTool[] {
    return [...this.customTools];
  }

  /** @deprecated Use getCustomTools() instead */
  getPlugins(): CustomTool[] {
    return this.getCustomTools();
  }

  /** Extract tool metadata for a tool by name. */
  getToolMetadata(name: string):
    | {
        toolType: "built-in" | "custom";
        toolVersion?: string;
        toolHash?: string;
        toolSource?: string;
        systemPromptHash?: string;
      }
    | undefined {
    const tool = this.toolMap.get(name);
    if (!tool) return undefined;

    const custom = this.customTools.find((t) => t.name === name);
    if (custom) {
      return {
        toolType: "custom",
        toolVersion: custom.source.toolVersion,
        toolHash: custom.source.toolHash,
        toolSource: custom.source.location,
        systemPromptHash: custom.systemPromptHash,
      };
    }

    return { toolType: "built-in" };
  }

  /** Total count of unique tools. */
  get size(): number {
    return this.toolMap.size;
  }
}
