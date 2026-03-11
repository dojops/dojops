import { LLMProvider } from "@dojops/core";
import { DevOpsModule } from "@dojops/sdk";
import { DopsRuntimeV2, parseDopsFile, validateDopsModule, DocProvider } from "@dojops/runtime";
import * as fs from "node:fs";
import * as path from "node:path";
import { ModuleRegistry } from "./registry";
import { discoverUserDopsFiles } from "./dops-loader";
import { loadModulePolicy, isModuleAllowed } from "./policy";

export * from "./registry";
export * from "./dops-loader";
export * from "./policy";
export * from "./json-schema-to-zod";
export * from "./serializers";
export * from "./agent-parser";
export * from "./agent-loader";
export * from "./agent-schema";
export * from "./prompt-validator";

export interface CreateModuleRegistryOptions {
  /** Optional documentation augmenter for injecting up-to-date docs into module prompts */
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
 * Returns DopsRuntimeV2 instances for each valid v2 module.
 */
export function loadBuiltInModules(
  provider: LLMProvider,
  options?: CreateModuleRegistryOptions,
): DevOpsModule[] {
  const modulesDir = path.join(__dirname, "../../runtime/modules");
  const modules: DevOpsModule[] = [];

  try {
    if (!fs.existsSync(modulesDir)) return modules;

    const files = fs.readdirSync(modulesDir) as string[];
    for (const file of files) {
      if (!file.endsWith(".dops")) continue;
      try {
        const module = parseDopsFile(path.join(modulesDir, file));
        const validation = validateDopsModule(module);
        if (validation.valid) {
          modules.push(
            new DopsRuntimeV2(module, provider, {
              docAugmenter: options?.docAugmenter,
              context7Provider: options?.context7Provider,
              projectContext: options?.projectContext,
              onBinaryMissing: options?.onBinaryMissing,
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

  return modules;
}

/**
 * Load user .dops files from global/project directories.
 * Only v2 .dops modules are supported.
 */
export function loadUserModules(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateModuleRegistryOptions,
): { modules: DevOpsModule[]; warnings: string[] } {
  const dopsFiles = discoverUserDopsFiles(projectPath);
  const modules: DevOpsModule[] = [];
  const warnings: string[] = [];

  for (const entry of dopsFiles) {
    try {
      const module = parseDopsFile(entry.filePath);
      const validation = validateDopsModule(module);
      if (validation.valid) {
        modules.push(
          new DopsRuntimeV2(module, provider, {
            docAugmenter: options?.docAugmenter,
            context7Provider: options?.context7Provider,
            projectContext: options?.projectContext,
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

  return { modules, warnings };
}

/**
 * Convenience factory: builds a ModuleRegistry with all built-in .dops modules
 * plus any valid, policy-allowed user .dops modules.
 */
export function createModuleRegistry(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateModuleRegistryOptions,
): ModuleRegistry {
  // 1. Built-in .dops modules (sole built-in module source)
  const builtInModules: DevOpsModule[] = loadBuiltInModules(provider, options);

  // 2. Load user .dops files, apply policy filter
  const policy = loadModulePolicy(projectPath);
  const { modules: userModules } = loadUserModules(provider, projectPath, options);
  const allowedModules = userModules.filter((m) => isModuleAllowed(m.name, policy));

  // Add user .dops runtimes (they'll override by name in registry)
  builtInModules.push(...allowedModules);

  return new ModuleRegistry(builtInModules);
}
