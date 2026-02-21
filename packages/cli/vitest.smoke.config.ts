import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/smoke.test.ts", "src/**/smoke.test.ts", "src/**/*.smoke.test.ts"],
  },
});
