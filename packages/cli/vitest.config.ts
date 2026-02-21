import { defineConfig, defaultExclude } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      ...defaultExclude,
      "**/e2e.test.ts",
      "**/*.e2e.test.ts",
      "**/smoke.test.ts",
      "**/*.smoke.test.ts",
    ],
    passWithNoTests: true,
  },
});
