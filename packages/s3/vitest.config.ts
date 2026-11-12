import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests run in the root "integration" project instead.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
