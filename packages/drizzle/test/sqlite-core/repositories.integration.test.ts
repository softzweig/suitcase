import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSqliteRepositories } from "../../src/sqlite-core/repositories.js";
import { tables } from "../../src/sqlite-core/schema.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { newAsset, newResource } from "../support/fixtures.js";
import { pathFromUrl } from "../support/paths.js";

const migrationsFolder = pathFromUrl(new URL("../../migrations/sqlite", import.meta.url));

/** Every table exported by the schema, so new ones join the reset automatically. */
const deleteAll = Object.values(tables)
  .filter((value) => value instanceof SQLiteTable)
  .map((table) => `delete from "${getTableConfig(table).name}"`)
  // Reversed: children first, because the foreign keys are RESTRICT.
  .reverse();

const connect = async () => {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  return {
    client,
    repositories: createSqliteRepositories(db),
    reset: async () => {
      await client.batch(deleteAll, "write");
    },
  };
};

describeRepositories("sqlite-core", async () => {
  const { client, repositories, reset } = await connect();

  return { ...repositories, reset, close: async () => client.close() };
});

describe("sqlite-core database quirks", () => {
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(async () => connection.client.close());

  beforeEach(() => connection.reset());

  it("returns null for ids that are not uuids", async () => {
    await expect(connection.repositories.resources.findById("missing")).resolves.toBeNull();
  });

  it("stores sizes beyond the 32-bit integer range", async () => {
    const row = newAsset({ size: 2 ** 40 });
    await connection.repositories.assets.insert(row);

    await expect(connection.repositories.assets.findById(row.id)).resolves.toEqual(row);
  });

  it("preserves json key order", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const row = newResource({ assetId: asset.id, metadata: { b: 1, a: 2 } });
    await connection.repositories.resources.insert(row);

    const found = await connection.repositories.resources.findById(row.id);

    expect(JSON.stringify(found?.metadata)).toBe('{"b":1,"a":2}');
  });

  it("creates the partial expiry index", async () => {
    const { rows } = await connection.client.execute(
      "select sql from sqlite_master where name = 'upload_sessions_expiry_idx'",
    );

    expect(String(rows[0]?.sql)).toContain("WHERE");
    expect(String(rows[0]?.sql)).toContain("<> 'completed'");
  });

  it("keeps the transaction usable after a failed statement", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());

    await connection.repositories.resources.transaction(async (context) => {
      const resources = connection.repositories.resources.withContext(context);

      // The same foreign key violation that aborts a postgres transaction here
      // only fails the statement, so the transaction carries on.
      await expect(
        resources.insert(newResource({ assetId: crypto.randomUUID() })),
      ).rejects.toThrow();
      await resources.insert(newResource({ assetId: asset.id }));
    });

    await expect(
      connection.repositories.resources.findMany({ assetId: asset.id }),
    ).resolves.toHaveLength(1);
  });
});
