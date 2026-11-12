import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./drizzle.sqlite.schema.ts",
  out: "./migrations/sqlite",
  // Only used by push/studio/migrate; `generate` never connects.
  dbCredentials: { url: ":memory:" },
});
