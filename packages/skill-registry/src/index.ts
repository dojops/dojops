import { LLMProvider } from "@dojops/core";
import { DevOpsSkill } from "@dojops/sdk";
import { DopsRuntimeV2, parseDopsFile, validateDopsSkill, type DocProvider } from "@dojops/runtime";
import { validateSystemPrompt } from "./prompt-validator";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SkillRegistry } from "./registry";
import { discoverUserDopsFiles } from "./dops-loader";
import { loadSkillPolicy, isSkillAllowed } from "./policy";

export * from "./registry";
export * from "./dops-loader";
export * from "./policy";
export * from "./json-schema-to-zod";
export * from "./serializers";
export * from "./agent-parser";
export * from "./agent-loader";
export * from "./agent-schema";
export * from "./prompt-validator";

export interface CreateSkillRegistryOptions {
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
 * Load built-in .dops skills from @dojops/runtime/skills/.
 * Returns DopsRuntimeV2 instances for each valid v2 skill.
 */
export function loadBuiltInModules(
  provider: LLMProvider,
  options?: CreateSkillRegistryOptions,
): DevOpsSkill[] {
  const modulesDir = path.join(__dirname, "../../runtime/skills");
  const modules: DevOpsSkill[] = [];

  try {
    if (!fs.existsSync(modulesDir)) return modules;

    const files = fs.readdirSync(modulesDir) as string[];
    for (const file of files) {
      if (!file.endsWith(".dops")) continue;
      try {
        const module = parseDopsFile(path.join(modulesDir, file));
        const validation = validateDopsSkill(module);
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
 * Re-verify a skill file's SHA-256 hash against the sidecar stored at install time.
 * Returns true if no sidecar exists (non-hub skill) or hash matches.
 * Returns false if the hash has changed (file was tampered with after install).
 */
function verifySkillIntegrity(filePath: string): { valid: boolean; reason?: string } {
  const hashPath = `${filePath}.sha256`;
  if (!fs.existsSync(hashPath)) return { valid: true }; // No sidecar — not a hub-installed skill
  try {
    const expectedHash = fs.readFileSync(hashPath, "utf-8").trim();
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    if (actualHash !== expectedHash) {
      return {
        valid: false,
        reason: `SHA-256 mismatch: file has been modified since install (expected ${expectedHash.slice(0, 12)}..., got ${actualHash.slice(0, 12)}...)`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: true }; // Cannot read sidecar, skip check
  }
}

/**
 * Load user .dops files from global/project directories.
 * Only v2 .dops modules are supported.
 * Custom skills are loaded with trustLevel "custom" and undergo injection detection + integrity checks.
 */
export function loadUserModules(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateSkillRegistryOptions,
): { modules: DevOpsSkill[]; warnings: string[] } {
  const dopsFiles = discoverUserDopsFiles(projectPath);
  const modules: DevOpsSkill[] = [];
  const warnings: string[] = [];

  for (const entry of dopsFiles) {
    try {
      // Re-verify SHA-256 for hub-installed skills
      const integrity = verifySkillIntegrity(entry.filePath);
      if (!integrity.valid) {
        warnings.push(`Blocked .dops file ${entry.filePath}: ${integrity.reason}`);
        continue;
      }

      const module = parseDopsFile(entry.filePath);
      const validation = validateDopsSkill(module);
      if (validation.valid) {
        // Run injection detection on custom skill prompts
        const promptCheck = validateSystemPrompt(module.sections.prompt);
        if (promptCheck.block) {
          warnings.push(
            `Blocked .dops file ${entry.filePath}: injection pattern detected (confidence: ${promptCheck.confidence.toFixed(2)}). ${promptCheck.warnings.join("; ")}`,
          );
          continue;
        }
        if (!promptCheck.safe) {
          warnings.push(
            `Warning for .dops file ${entry.filePath}: suspicious patterns detected — ${promptCheck.warnings.join("; ")}`,
          );
        }

        modules.push(
          new DopsRuntimeV2(module, provider, {
            docAugmenter: options?.docAugmenter,
            context7Provider: options?.context7Provider,
            projectContext: options?.projectContext,
            trustLevel: "custom",
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
 * Convenience factory: builds a SkillRegistry with all built-in .dops modules
 * plus any valid, policy-allowed user .dops modules.
 */
export function createSkillRegistry(
  provider: LLMProvider,
  projectPath?: string,
  options?: CreateSkillRegistryOptions,
): SkillRegistry {
  // 1. Built-in .dops modules (sole built-in module source)
  const builtInModules: DevOpsSkill[] = loadBuiltInModules(provider, options);

  // 2. Load user .dops files, apply policy filter
  const policy = loadSkillPolicy(projectPath);
  const { modules: userSkills } = loadUserModules(provider, projectPath, options);
  const allowedSkills = userSkills.filter((m) => isSkillAllowed(m.name, policy));

  // Add user .dops runtimes (they'll override by name in registry)
  builtInModules.push(...allowedSkills);

  return new SkillRegistry(builtInModules);
}
