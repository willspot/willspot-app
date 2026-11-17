import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["services/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
