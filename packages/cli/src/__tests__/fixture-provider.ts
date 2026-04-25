import { vi } from "vitest";
import type { LLMProvider, LLMRequest, LLMResponse } from "@dojops/core";
import type { CLIContext, GlobalOptions } from "../types";

/**
 * A rule that matches incoming LLMRequests and returns canned responses.
 * The first matching rule wins (order matters).
 */
export interface FixtureRule {
  /** Match against system prompt substring. */
  systemContains?: string;
  /** Match against user prompt substring. */
  promptContains?: string;
  /** The canned response to return. */
  response: LLMResponse;
}

/**
 * LLMProvider backed by fixture rules — no network calls.
 * Falls back to a generic "Mock response" if nothing matches.
 */
export function createFixtureProvider(rules: FixtureRule[]): LLMProvider & { calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];

  return {
    name: "fixture",
    calls,
    generate: vi.fn().mockImplementation(async (req: LLMRequest): Promise<LLMResponse> => {
      calls.push(req);
      for (const rule of rules) {
        if (rule.systemContains && !req.system?.includes(rule.systemContains)) continue;
        if (rule.promptContains && !req.prompt?.includes(rule.promptContains)) continue;
        return rule.response;
      }
      return { content: "Mock response" };
    }),
  };
}

/**
 * Build a CLIContext suitable for integration tests.
 * Accepts a provider and optional global option overrides.
 */
export function makeTestCtx(provider: LLMProvider, overrides?: Partial<GlobalOptions>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: true,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp/test-project",
    getProvider: () => provider,
  };
}
