import { defineConfig } from "drizzle-kit";
import { DATABASE_URL, ensureDataFolder } from "./src/paths";

ensureDataFolder();

/** The tables `@softzweig/suitcase-drizzle` ships, applied with `pnpm db:push`. */
export default defineConfig({
  dbCredentials: { url: DATABASE_URL },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/schema.ts",
});
