import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { DrizzleDatabase } from "@softzweig/spindle-drizzle";
import { createPostgresServerAdapters, tables } from "@softzweig/suitcase-drizzle/pg-core";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll } from "vitest";
import {
  createExampleBuckets,
  createExampleDefinition,
  createExampleStack,
  DEFAULT_USER_ID,
  type Stack,
} from "./app.js";

/** The migrations the drizzle package ships, from this repo's checkout. */
const migrations = fileURLToPath(new URL("../../../drizzle/migrations/pg", import.meta.url));

/** Every table the schema exports, so a reset covers new ones without being updated. */
const truncateAll = Object.values(tables)
  .filter((value) => value instanceof PgTable)
  .map((table) => `"${getTableConfig(table).name}"`)
  .join(", ");

/** One in-process database for the whole file: migrations are the part that costs time. */
let connection: Promise<{ db: DrizzleDatabase; reset: () => Promise<void> }> | undefined;
let client: PGlite | undefined;

afterAll(() => client?.close());

const connect = async () => {
  client = new PGlite();
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: migrations });

  return {
    db,
    // Each app starts from empty tables, so one test's assets cannot make the next one's
    // uploads dedupe.
    reset: async () => {
      await client?.exec(`truncate ${truncateAll} cascade`);
    },
  };
};

/**
 * The same app on Postgres: pglite runs the database in-process, so the flow goes through real
 * rows, transactions and constraints without a container. Storage stays in memory, where a bucket
 * has its own integration tests.
 */
export const createPgExampleApp = async ({
  userId = DEFAULT_USER_ID,
}: {
  userId?: string;
} = {}): Promise<Stack> => {
  connection ??= connect();
  const { db, reset } = await connection;
  await reset();

  const buckets = createExampleBuckets();
  const definition = createExampleDefinition(buckets);

  return createExampleStack(buckets, definition, createPostgresServerAdapters(db), { userId });
};
