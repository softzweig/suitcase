import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { tables } from "../../src/sqlite-core/schema.js";
import { createSqliteServerAdapters } from "../../src/sqlite-core/server.js";
import { describeServer } from "../contract/server.integration.js";
import { pathFromUrl } from "../support/paths.js";

const migrationsFolder = pathFromUrl(new URL("../../migrations/sqlite", import.meta.url));

/** Every table exported by the schema, children first, because the foreign keys are RESTRICT. */
const deleteAll = Object.values(tables)
  .filter((value) => value instanceof SQLiteTable)
  .map((table) => `delete from "${getTableConfig(table).name}"`)
  .reverse();

describeServer("sqlite-core", async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  return {
    adapters: createSqliteServerAdapters(db),
    reset: async () => {
      await client.batch(deleteAll, "write");
    },
    close: async () => {
      client.close();
    },
  };
});
