import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts"],
    reporters: ["default", "junit"],
    outputFile: {
      junit: "test-report.junit.xml",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      exclude: [
        "**/*.test.ts",
        "**/*.e2e.test.ts",
        "**/*.smoke.test.ts",
        "**/dist/**",
        "**/node_modules/**",
        // CLI entry point + TUI: tested via subprocess integration tests (cli.test.ts)
        "packages/cli/src/index.ts",
        "packages/cli/src/tui/**",
        // Interactive-only modules: require TTY/stdin, not unit-testable
        "packages/cli/src/approval.ts",
        "packages/cli/src/stdin.ts",
        // LLM provider implementations: require external API calls, tested via e2e
        "packages/core/src/llm/anthropic.ts",
        "packages/core/src/llm/gemini.ts",
        "packages/core/src/llm/ollama.ts",
        "packages/core/src/llm/openai.ts",
        "packages/core/src/llm/openai-compat.ts",
        "packages/core/src/llm/deepseek.ts",
        "packages/core/src/llm/github-copilot.ts",
        "packages/core/src/llm/copilot-auth.ts",
        // CLI commands: require LLM + TTY, tested via subprocess integration (cli.test.ts)
        "packages/cli/src/commands/auto.ts",
        "packages/cli/src/commands/plan.ts",
        "packages/cli/src/commands/auth.ts",
        "packages/cli/src/commands/chat.ts",
        "packages/cli/src/commands/debug.ts",
        "packages/cli/src/commands/serve.ts",
        "packages/cli/src/commands/analyze.ts",
        "packages/cli/src/commands/review.ts",
      ],
      thresholds: {
        lines: 65,
        functions: 65,
        branches: 55,
        statements: 65,
      },
    },
  },
});
