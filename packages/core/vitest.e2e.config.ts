import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/providers.e2e.test.ts", "src/**/*.e2e.test.ts"],
  },
});
