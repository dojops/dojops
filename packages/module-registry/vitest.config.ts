import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@dojops/sdk": path.resolve(__dirname, "../sdk/src"),
      "@dojops/core": path.resolve(__dirname, "../core/src"),
    },
  },
});
