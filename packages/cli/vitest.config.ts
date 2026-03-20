import { defineConfig, defaultExclude } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      ...defaultExclude,
      "**/e2e.test.ts",
      "**/*.e2e.test.ts",
      "**/e2e-*.test.ts",
      "**/smoke.test.ts",
      "**/*.smoke.test.ts",
    ],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@dojops/core": path.resolve(__dirname, "../core/src"),
      "@dojops/skill-registry": path.resolve(__dirname, "../skill-registry/src"),
      "@dojops/sdk": path.resolve(__dirname, "../sdk/src"),
    },
  },
});
