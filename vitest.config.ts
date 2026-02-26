import { defineConfig } from "vitest/config";
import { codecovVitePlugin } from "@codecov/vite-plugin";

export default defineConfig({
  plugins: [
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: "dojops",
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
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
        lines: 75,
        functions: 70,
        branches: 60,
        statements: 75,
      },
    },
  },
});
