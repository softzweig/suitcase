import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One global run for the whole monorepo: every package is its own project,
    // named after its package.json `name` (filter with --project). Integration
    // tests live in their own project because they need real databases.
    projects: [
      "packages/*",
      "!packages/typescript-config",
      {
        test: {
          name: "integration",
          include: ["packages/*/test/**/*.integration.test.ts"],
        },
      },
    ],
  },
});
