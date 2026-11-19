import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["services/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    // On GitHub Actions, also emit each failure as an annotation (test name, file, assertion),
    // readable through the API without downloading the log.
    reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
  },
});
