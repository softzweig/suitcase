import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One global run for the whole monorepo: every package is its own project,
    // named after its package.json `name` (filter with --project).
    projects: ["packages/*", "!packages/typescript-config"],
  },
});
