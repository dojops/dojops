import { LLMProvider } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import {
  DopsRuntime,
  DopsRuntimeV2,
  parseDopsFileAny,
  validateDopsModuleAny,
  isV2Module,
  DocProvider,
} from "@dojops/runtime";
import * as fs from "node:fs";
import * as path from "node:path";
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
  /** Optional Context7 DocProvider for v2 .dops modules */
  context7Provider?: DocProvider;
  /** Optional project context string for v2 .dops modules */
  projectContext?: string;
  /** Callback to auto-install missing verification binaries via toolchain */
  onBinaryMissing?: (binaryName: string) => Promise<boolean>;
}

/**
 * Load built-in .dops modules from @dojops/runtime/modules/.
 * Returns DevOpsTool instances (DopsRuntime for v1, DopsRuntimeV2 for v2) for each valid module.
 */
export function loadBuiltInDopsModules(
  provider: LLMProvider,
  options?: CreateToolRegistryOptions,
): DevOpsTool[] {
  const modulesDir = path.join(__dirname, "../../runtime/modules");
  const tools: DevOpsTool[] = [];

  try {
    if (!fs.existsSync(modulesDir)) return tools;

    const files = fs.readdirSync(modulesDir) as string[];
    for (const file of files) {
      if (!file.endsWith(".dops")) continue;
      try {
        const module = parseDopsFileAny(path.join(modulesDir, file));
        const validation = validateDopsModuleAny(module);
        if (validation.valid) {
          if (isV2Module(module)) {
            tools.push(
              new DopsRuntimeV2(module, provider, {
                docAugmenter: options?.docAugmenter,
                context7Provider: options?.context7Provider,
                projectContext: options?.projectContext,
                onBinaryMissing: options?.onBinaryMissing,
              }),
            );
          } else {
            tools.push(
              new DopsRuntime(module, provider, {
                docAugmenter: options?.docAugmenter,
              }),
            );
          }
        }
      } catch {
        // Skip invalid modules silently
      }
    }
  } catch {
    // modules dir not found — not an error in dev/test
  }

  return tools;
}

/**
 * Load user .dops files from global/project directories.
 * Supports both v1 and v2 .dops formats.
 */
export function loadUserDopsModules(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateToolRegistryOptions,
): { tools: DevOpsTool[]; warnings: string[] } {
  const dopsFiles = discoverUserDopsFiles(projectPath);
  const tools: DevOpsTool[] = [];
  const warnings: string[] = [];

  for (const entry of dopsFiles) {
    try {
      const module = parseDopsFileAny(entry.filePath);
      const validation = validateDopsModuleAny(module);
      if (validation.valid) {
        if (isV2Module(module)) {
          tools.push(
            new DopsRuntimeV2(module, provider, {
              docAugmenter: options?.docAugmenter,
              context7Provider: options?.context7Provider,
              projectContext: options?.projectContext,
            }),
          );
        } else {
          tools.push(
            new DopsRuntime(module, provider, {
              docAugmenter: options?.docAugmenter,
            }),
          );
        }
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

  return { tools, warnings };
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
  const { tools: userDopsTools } = loadUserDopsModules(provider, projectPath, options);
  const allowedDops = userDopsTools.filter((rt) => isToolAllowed(rt.name, policy));

  // Add user .dops runtimes as built-in tools (they'll override by name in registry)
  builtInTools.push(...allowedDops);

  return new ToolRegistry(builtInTools, customTools);
}
