import { DevOpsTool } from "@dojops/sdk";
import { CustomTool } from "./custom-tool";

/**
 * Interface for DopsRuntime metadata access.
 * Avoids direct dependency on @dojops/runtime from tool-registry.
 */
export interface DopsRuntimeLike extends DevOpsTool {
  readonly systemPromptHash: string;
  readonly moduleHash: string;
  readonly metadata: {
    toolType: "built-in" | "custom";
    toolVersion: string;
    toolHash: string;
    toolSource: string;
    systemPromptHash: string;
  };
}

function isDopsRuntime(tool: DevOpsTool): tool is DopsRuntimeLike {
  return (
    "moduleHash" in tool &&
    "metadata" in tool &&
    typeof (tool as DopsRuntimeLike).metadata === "object"
  );
}

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
      if (this.toolMap.has(custom.name) && this.builtIn.some((b) => b.name === custom.name)) {
        console.warn(`[tool-registry] Custom tool "${custom.name}" overrides built-in tool`);
      }
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

    // Check if it's a DopsRuntime instance (has metadata property)
    if (isDopsRuntime(tool)) {
      return tool.metadata;
    }

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
