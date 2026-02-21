import { defineConfig, defaultExclude } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...defaultExclude, "**/providers.e2e.test.ts", "**/*.e2e.test.ts"],
  },
});
