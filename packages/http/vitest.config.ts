import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The end-to-end flow runs in the root "integration" project instead.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
