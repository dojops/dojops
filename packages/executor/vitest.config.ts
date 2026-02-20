import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@oda/sdk": path.resolve(__dirname, "../sdk/src"),
    },
  },
});
