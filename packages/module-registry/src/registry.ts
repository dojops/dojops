import { DevOpsModule } from "@dojops/sdk";

/**
 * Interface for DopsRuntime metadata access.
 * Avoids direct dependency on @dojops/runtime from module-registry.
 */
export interface DopsRuntimeLike extends DevOpsModule {
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

function isDopsRuntime(module: DevOpsModule): module is DopsRuntimeLike {
  return (
    "moduleHash" in module &&
    "metadata" in module &&
    typeof (module as DopsRuntimeLike).metadata === "object"
  );
}

/**
 * Central registry combining built-in and user .dops modules.
 * Provides a unified getAll() / get(name) interface for Planner, Executor, CLI, and API.
 */
export class ModuleRegistry {
  private readonly moduleMap: Map<string, DevOpsModule>;
  private readonly builtIn: DevOpsModule[];

  constructor(builtInModules: DevOpsModule[]) {
    this.builtIn = builtInModules;
    this.moduleMap = new Map();

    for (const mod of builtInModules) {
      this.moduleMap.set(mod.name, mod);
    }
  }

  /** All modules, deduplicated by name. */
  getAll(): DevOpsModule[] {
    return Array.from(this.moduleMap.values());
  }

  /** Look up a module by name. */
  get(name: string): DevOpsModule | undefined {
    return this.moduleMap.get(name);
  }

  /** Check if a module exists by name. */
  has(name: string): boolean {
    return this.moduleMap.has(name);
  }

  /** Get only built-in modules. */
  getBuiltIn(): DevOpsModule[] {
    return [...this.builtIn];
  }

  /** Extract module metadata by name. */
  getModuleMetadata(name: string):
    | {
        toolType: "built-in" | "custom";
        toolVersion?: string;
        toolHash?: string;
        toolSource?: string;
        systemPromptHash?: string;
      }
    | undefined {
    const mod = this.moduleMap.get(name);
    if (!mod) return undefined;

    // Check if it's a DopsRuntime instance (has metadata property)
    if (isDopsRuntime(mod)) {
      return mod.metadata;
    }

    return { toolType: "built-in" };
  }

  /** Total count of unique modules. */
  get size(): number {
    return this.moduleMap.size;
  }
}
