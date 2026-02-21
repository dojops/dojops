import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/e2e.test.ts", "src/**/e2e.test.ts", "src/**/*.e2e.test.ts"],
  },
  resolve: {
    alias: {
      "@odaops/core": path.resolve(__dirname, "../core/src"),
      "@odaops/sdk": path.resolve(__dirname, "../sdk/src"),
      "@odaops/planner": path.resolve(__dirname, "../planner/src"),
      "@odaops/tools": path.resolve(__dirname, "../tools/src"),
      "@odaops/executor": path.resolve(__dirname, "../executor/src"),
    },
  },
});
