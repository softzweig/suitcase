import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../../src/pg-core/repositories.js";
import { tables } from "../../src/pg-core/schema.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { newAsset, newResource } from "../support/fixtures.js";
import { pathFromUrl } from "../support/paths.js";

const migrationsFolder = pathFromUrl(new URL("../../migrations/pg", import.meta.url));

/** Every table exported by the schema, so new ones join the reset automatically. */
const truncateAll = Object.values(tables)
  .filter((value) => value instanceof PgTable)
  .map((table) => `"${getTableConfig(table).name}"`)
  .join(", ");

const connect = async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  return {
    client,
    repositories: createPostgresRepositories(db),
    reset: async () => {
      await client.exec(`truncate ${truncateAll} cascade`);
    },
  };
};

describeRepositories("pg-core", async () => {
  const { client, repositories, reset } = await connect();

  return { ...repositories, reset, close: () => client.close() };
});

describe("pg-core database quirks", () => {
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(() => connection.client.close());

  beforeEach(() => connection.reset());

  it("rejects ids that are not uuids", async () => {
    await expect(connection.repositories.resources.findById("missing")).rejects.toThrow();
  });

  it("rejects asset sizes outside the integer range", async () => {
    await expect(
      connection.repositories.assets.insert(newAsset({ size: 2 ** 40 })),
    ).rejects.toThrow();
  });

  it("normalizes jsonb key order", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const row = newResource({ assetId: asset.id, metadata: { b: 1, a: 2 } });
    await connection.repositories.resources.insert(row);

    const found = await connection.repositories.resources.findById(row.id);

    expect(JSON.stringify(found?.metadata)).toBe('{"a":2,"b":1}');
  });

  it("creates the gin and partial indexes", async () => {
    const { rows } = await connection.client.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename in ('resources', 'upload_sessions')",
    );
    const defs = rows.map(({ indexdef }) => indexdef).join("\n");

    expect(defs).toContain("jsonb_path_ops");
    expect(defs).toContain("WHERE");
    expect(defs).toContain("'completed'");
  });

  it("aborts the transaction after a failed statement", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());

    const run = connection.repositories.resources.transaction(async (context) => {
      const resources = connection.repositories.resources.withContext(context);

      // A foreign key violation fails this statement...
      await expect(
        resources.insert(newResource({ assetId: crypto.randomUUID() })),
      ).rejects.toThrow();

      // ...and the session then refuses everything after it, so even a statement
      // that would have succeeded fails. Catching both does not save the
      // transaction.
      await expect(resources.insert(newResource({ assetId: asset.id }))).rejects.toThrow();
    });

    // How the poisoning surfaces is the driver's business: this one reports it
    // when committing, where node-postgres gets a silent rollback from the
    // server. The durable outcome is the same either way.
    await expect(run).rejects.toThrow();
    await expect(connection.repositories.resources.findMany({})).resolves.toEqual([]);
  });
});
