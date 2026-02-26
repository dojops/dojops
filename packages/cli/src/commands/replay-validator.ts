import { ToolRegistry, PluginTool } from "@dojops/tool-registry";
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
 * 4. systemPromptHash matches for plugin tasks
 */
export function validateReplayIntegrity(
  plan: PlanState,
  currentProvider: string,
  currentModel: string | undefined,
  registry: ToolRegistry,
): ReplayValidationResult {
  const mismatches: ReplayMismatch[] = [];

  if (!plan.executionContext) {
    mismatches.push({
      field: "executionContext",
      expected: "(present)",
      actual: "(missing)",
    });
    return { mismatches, valid: false };
  }

  if (plan.executionContext.provider !== currentProvider) {
    mismatches.push({
      field: "provider",
      expected: plan.executionContext.provider,
      actual: currentProvider,
    });
  }

  if (plan.executionContext.model && currentModel && plan.executionContext.model !== currentModel) {
    mismatches.push({
      field: "model",
      expected: plan.executionContext.model,
      actual: currentModel,
    });
  }

  // Check dojopsVersion in replay mode
  if (plan.executionContext.dojopsVersion) {
    const currentVersion = getDojopsVersion();
    if (plan.executionContext.dojopsVersion !== currentVersion) {
      mismatches.push({
        field: "dojopsVersion",
        expected: plan.executionContext.dojopsVersion,
        actual: currentVersion,
      });
    }
  }

  for (const task of plan.tasks) {
    if (task.toolType !== "plugin") continue;
    if (!task.systemPromptHash) continue;

    const metadata = registry.getToolMetadata(task.tool);
    if (!metadata || metadata.toolType !== "plugin") continue;
    if (!metadata.systemPromptHash) continue;

    if (task.systemPromptHash !== metadata.systemPromptHash) {
      mismatches.push({
        field: "systemPromptHash",
        expected: task.systemPromptHash.slice(0, 12),
        actual: metadata.systemPromptHash.slice(0, 12),
        taskId: task.id,
      });
    }
  }

  return { mismatches, valid: mismatches.length === 0 };
}

/**
 * Checks plugin integrity for resume operations.
 * Extracted from apply.ts for independent testability.
 */
export function checkPluginIntegrity(
  planTasks: PlanState["tasks"],
  currentTools: Array<{ name: string }>,
): { mismatches: string[]; hasMismatches: boolean } {
  const mismatches: string[] = [];

  for (const task of planTasks) {
    if (task.toolType !== "plugin") continue;

    const currentTool = currentTools.find((t) => t.name === task.tool);
    if (!currentTool) {
      mismatches.push(`Plugin "${task.tool}" no longer available (was v${task.pluginVersion})`);
      continue;
    }

    if (currentTool instanceof PluginTool && task.pluginHash) {
      const currentHash = currentTool.source.pluginHash;
      if (currentHash !== task.pluginHash) {
        mismatches.push(
          `Plugin "${task.tool}" changed: plan used v${task.pluginVersion} (${task.pluginHash?.slice(0, 8)}), ` +
            `current is v${currentTool.source.pluginVersion} (${currentHash?.slice(0, 8)})`,
        );
      }
    }
  }

  return { mismatches, hasMismatches: mismatches.length > 0 };
}
