import { LLMProvider } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { DopsRuntime, parseDopsFile, validateDopsModule } from "@dojops/runtime";
import * as fs from "fs";
import * as path from "path";
import { ToolRegistry } from "./registry";
import { CustomTool } from "./custom-tool";
import { discoverTools, discoverUserDopsFiles } from "./tool-loader";
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
export * from "./prompt-validator";

export interface CreateToolRegistryOptions {
  /** Optional documentation augmenter for injecting up-to-date docs into tool prompts */
  docAugmenter?: {
    augmentPrompt(s: string, kw: string[], q: string): Promise<string>;
  };
}

/**
 * Load built-in .dops modules from @dojops/runtime/modules/.
 * Returns DopsRuntime instances for each valid module.
 */
export function loadBuiltInDopsModules(
  provider: LLMProvider,
  options?: CreateToolRegistryOptions,
): DopsRuntime[] {
  const modulesDir = path.join(__dirname, "../../runtime/modules");
  const runtimes: DopsRuntime[] = [];

  try {
    if (!fs.existsSync(modulesDir)) return runtimes;

    const files = fs.readdirSync(modulesDir) as string[];
    for (const file of files) {
      if (!file.endsWith(".dops")) continue;
      try {
        const module = parseDopsFile(path.join(modulesDir, file));
        const validation = validateDopsModule(module);
        if (validation.valid) {
          runtimes.push(
            new DopsRuntime(module, provider, {
              docAugmenter: options?.docAugmenter,
            }),
          );
        }
      } catch {
        // Skip invalid modules silently
      }
    }
  } catch {
    // modules dir not found — not an error in dev/test
  }

  return runtimes;
}

/**
 * Load user .dops files from global/project directories.
 */
export function loadUserDopsModules(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateToolRegistryOptions,
): { runtimes: DopsRuntime[]; warnings: string[] } {
  const dopsFiles = discoverUserDopsFiles(projectPath);
  const runtimes: DopsRuntime[] = [];
  const warnings: string[] = [];

  for (const entry of dopsFiles) {
    try {
      const module = parseDopsFile(entry.filePath);
      const validation = validateDopsModule(module);
      if (validation.valid) {
        runtimes.push(
          new DopsRuntime(module, provider, {
            docAugmenter: options?.docAugmenter,
          }),
        );
      } else {
        warnings.push(
          `Invalid .dops file ${entry.filePath}: ${(validation.errors ?? []).join(", ")}`,
        );
      }
    } catch (err) {
      warnings.push(
        `Failed to load .dops file ${entry.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { runtimes, warnings };
}

/**
 * Convenience factory: builds a ToolRegistry with all built-in .dops modules
 * plus any valid, policy-allowed custom tools.
 */
export function createToolRegistry(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateToolRegistryOptions,
): ToolRegistry {
  // 1. Built-in .dops modules (sole built-in tool source)
  const builtInTools: DevOpsTool[] = loadBuiltInDopsModules(provider, options);

  // 2. Discover legacy custom tools (tool.yaml manifests)
  const toolEntries = discoverTools(projectPath);

  // 3. Apply policy filter
  const policy = loadToolPolicy(projectPath);
  const allowedEntries = toolEntries.filter((entry) => isToolAllowed(entry.manifest.name, policy));

  // 4. Create CustomTool instances from legacy manifests (FB10: pass projectPath for output)
  const customTools: CustomTool[] = allowedEntries.map(
    (entry) =>
      new CustomTool(
        entry.manifest,
        provider,
        entry.toolDir,
        entry.source,
        entry.inputSchemaRaw,
        entry.outputSchemaRaw,
        projectPath,
      ),
  );

  // 5. Load user .dops files (treated as custom tools, can override built-in)
  const { runtimes: userDopsRuntimes } = loadUserDopsModules(provider, projectPath, options);
  const allowedDops = userDopsRuntimes.filter((rt) => isToolAllowed(rt.name, policy));

  // Add user .dops runtimes as built-in tools (they'll override by name in registry)
  builtInTools.push(...allowedDops);

  return new ToolRegistry(builtInTools, customTools);
}
