import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { tables } from "../../src/pg-core/schema.js";
import { createPostgresServerAdapters } from "../../src/pg-core/server.js";
import { describeServer } from "../contract/server.integration.js";
import { pathFromUrl } from "../support/paths.js";

const migrationsFolder = pathFromUrl(new URL("../../migrations/pg", import.meta.url));

/** Every table exported by the schema, so new ones join the reset automatically. */
const truncateAll = Object.values(tables)
  .filter((value) => value instanceof PgTable)
  .map((table) => `"${getTableConfig(table).name}"`)
  .join(", ");

describeServer("pg-core", async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  return {
    adapters: createPostgresServerAdapters(db),
    reset: async () => {
      await client.exec(`truncate ${truncateAll} cascade`);
    },
    close: () => client.close(),
  };
});
