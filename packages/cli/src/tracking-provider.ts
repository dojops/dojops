/**
 * LLM provider wrapper that records token usage to disk after every call.
 */

import type { LLMProvider, LLMRequest, LLMResponse } from "@dojops/core";
import { recordTokenUsage } from "./token-store";
import { checkBudget, printBudgetWarnings } from "./budget";
import { loadConfig } from "./config";

export class TrackingProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly inner: LLMProvider,
    private readonly rootDir: string,
    private readonly command: string,
  ) {
    this.name = inner.name;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.inner.generate(request);

    if (response.usage) {
      recordTokenUsage(this.rootDir, {
        timestamp: new Date().toISOString(),
        command: this.command,
        provider: this.inner.name,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      });

      // Budget check after recording usage
      const config = loadConfig();
      if (config.budget) {
        const status = checkBudget(this.rootDir, config.budget);
        if (status.warnings.length > 0) {
          printBudgetWarnings(status);
        }
        if (status.exceeded && config.budget.action === "block") {
          throw new Error("Budget exceeded. Use --force or increase budget in config.");
        }
      }
    }

    return response;
  }

  listModels?(): Promise<string[]> {
    return this.inner.listModels?.() ?? Promise.resolve([]);
  }
}

/**
 * Wrap a provider with automatic token usage tracking.
 * If rootDir is null (no project found), returns the original provider unwrapped.
 */
export function withTracking(
  provider: LLMProvider,
  rootDir: string | null,
  command: string,
): LLMProvider {
  if (!rootDir) return provider;
  return new TrackingProvider(provider, rootDir, command);
}
