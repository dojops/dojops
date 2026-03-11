import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],
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
