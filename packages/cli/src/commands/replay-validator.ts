import { ToolRegistry, CustomTool } from "@dojops/tool-registry";
import { PlanState, getDojopsVersion } from "../state";

export interface ReplayMismatch {
  field: string;
  expected: string;
  actual: string;
  taskId?: string;
}

export interface ReplayValidationResult {
  mismatches: ReplayMismatch[];
  valid: boolean;
}

/**
 * Validates that the current environment matches the plan's execution context.
 * Used by `--replay` mode to ensure deterministic reproducibility.
 *
 * Checks:
 * 1. executionContext exists (fail if missing — legacy plan)
 * 2. provider matches
 * 3. model matches (if plan stored one)
 * 4. systemPromptHash matches for custom tool tasks
 */
/** Check execution context fields for mismatches. */
function checkContextMismatches(
  ctx: NonNullable<PlanState["executionContext"]>,
  currentProvider: string,
  currentModel: string | undefined,
  mismatches: ReplayMismatch[],
): void {
  if (ctx.provider !== currentProvider) {
    mismatches.push({ field: "provider", expected: ctx.provider, actual: currentProvider });
  }
  if (ctx.model && currentModel && ctx.model !== currentModel) {
    mismatches.push({ field: "model", expected: ctx.model, actual: currentModel });
  }
  if (ctx.dojopsVersion) {
    const currentVersion = getDojopsVersion();
    if (ctx.dojopsVersion !== currentVersion) {
      mismatches.push({
        field: "dojopsVersion",
        expected: ctx.dojopsVersion,
        actual: currentVersion,
      });
    }
  }
}

/** Check custom tool system prompt hashes for mismatches. */
function checkToolPromptHashes(
  tasks: PlanState["tasks"],
  registry: ToolRegistry,
  mismatches: ReplayMismatch[],
): void {
  for (const task of tasks) {
    if (task.toolType !== "custom" || !task.systemPromptHash) continue;
    const metadata = registry.getToolMetadata(task.tool);
    if (metadata?.toolType !== "custom" || !metadata.systemPromptHash) continue;
    if (task.systemPromptHash !== metadata.systemPromptHash) {
      mismatches.push({
        field: "systemPromptHash",
        expected: task.systemPromptHash.slice(0, 12),
        actual: metadata.systemPromptHash.slice(0, 12),
        taskId: task.id,
      });
    }
  }
}

export function validateReplayIntegrity(
  plan: PlanState,
  currentProvider: string,
  currentModel: string | undefined,
  registry: ToolRegistry,
): ReplayValidationResult {
  const mismatches: ReplayMismatch[] = [];

  if (!plan.executionContext) {
    mismatches.push({ field: "executionContext", expected: "(present)", actual: "(missing)" });
    return { mismatches, valid: false };
  }

  checkContextMismatches(plan.executionContext, currentProvider, currentModel, mismatches);
  checkToolPromptHashes(plan.tasks, registry, mismatches);

  return { mismatches, valid: mismatches.length === 0 };
}

/**
 * Checks tool integrity for resume operations.
 * Extracted from apply.ts for independent testability.
 */
export function checkToolIntegrity(
  planTasks: PlanState["tasks"],
  currentTools: Array<{ name: string }>,
): { mismatches: string[]; hasMismatches: boolean } {
  const mismatches: string[] = [];

  for (const task of planTasks) {
    if (task.toolType !== "custom") continue;

    const currentTool = currentTools.find((t) => t.name === task.tool);
    if (!currentTool) {
      mismatches.push(`Tool "${task.tool}" no longer available (was v${task.toolVersion})`);
      continue;
    }

    if (currentTool instanceof CustomTool && task.toolHash) {
      const currentHash = currentTool.source.toolHash;
      if (currentHash !== task.toolHash) {
        mismatches.push(
          `Tool "${task.tool}" changed: plan used v${task.toolVersion} (${task.toolHash?.slice(0, 8)}), ` +
            `current is v${currentTool.source.toolVersion} (${currentHash?.slice(0, 8)})`,
        );
      }
    }
  }

  return { mismatches, hasMismatches: mismatches.length > 0 };
}

// Backward compatibility alias
/** @deprecated Use checkToolIntegrity instead */
export const checkPluginIntegrity = checkToolIntegrity;
