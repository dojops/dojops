import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/e2e.test.ts", "src/**/e2e.test.ts", "src/**/*.e2e.test.ts"],
  },
  resolve: {
    alias: {
      "@dojops/core": path.resolve(__dirname, "../core/src"),
      "@dojops/sdk": path.resolve(__dirname, "../sdk/src"),
      "@dojops/planner": path.resolve(__dirname, "../planner/src"),
      "@dojops/executor": path.resolve(__dirname, "../executor/src"),
    },
  },
});
