import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Hooks need a DOM to render into.
    environment: "jsdom",
    // The end-to-end flow runs in the root "integration" project instead.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
