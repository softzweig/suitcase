import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSqliteRepositories } from "../../src/sqlite-core/repositories.js";
import { tables } from "../../src/sqlite-core/schema.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { newAsset, newResource, newUploadSession } from "../support/fixtures.js";
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

/**
 * The aggregate statements, against a real database: `count(*)` and `coalesce(sum(...), 0)`
 * are the parts that cannot be checked any other way.
 */
describe("sqlite-core usage", () => {
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(async () => connection.client.close());

  beforeEach(() => connection.reset());

  /** A resource whose asset holds `size` bytes, owned by the user the filter asks for. */
  const givenSizedResource = async (size: number, owner = { userId: "u_1" }) => {
    const asset = await connection.repositories.assets.insert(newAsset({ size }));
    await connection.repositories.resources.insert(newResource({ assetId: asset.id, owner }));

    return asset;
  };

  it("counts the resources and sums the assets behind them", async () => {
    await givenSizedResource(100);
    await givenSizedResource(250);
    await givenSizedResource(4000, { userId: "u_2" });

    const usage = await connection.repositories.resources.aggregateUsage({
      owner: { userId: "u_1" },
    });

    expect(usage).toEqual({ resourceCount: 2, scope: "resource", size: 350 });
  });

  it("answers zero when the filter matches nothing, rather than null", async () => {
    await givenSizedResource(100);

    const usage = await connection.repositories.resources.aggregateUsage({
      owner: { userId: "nobody" },
    });

    expect(usage).toEqual({ resourceCount: 0, scope: "resource", size: 0 });
  });

  it("counts an asset once per resource pointing at it", async () => {
    const asset = await givenSizedResource(500);
    await connection.repositories.resources.insert(newResource({ assetId: asset.id }));

    const usage = await connection.repositories.resources.aggregateUsage({
      owner: { userId: "u_1" },
    });

    expect(usage).toEqual({ resourceCount: 2, scope: "resource", size: 1000 });
  });

  it("sums the upload sessions an owner holds", async () => {
    const sessions = connection.repositories.uploadSessions;
    await sessions.insert(newUploadSession({ owner: { userId: "u_1" }, size: 64 }));
    await sessions.insert(newUploadSession({ owner: { userId: "u_1" }, size: 128 }));
    await sessions.insert(newUploadSession({ owner: { userId: "u_2" }, size: 512 }));

    const usage = await sessions.aggregateUsage({ owner: { userId: "u_1" } });

    expect(usage).toEqual({ scope: "upload", size: 192, uploadCount: 2 });
  });

  it("sums sizes beyond the 32-bit integer range", async () => {
    await givenSizedResource(2 ** 40);
    await givenSizedResource(2 ** 40);

    const usage = await connection.repositories.resources.aggregateUsage({
      owner: { userId: "u_1" },
    });

    expect(usage).toEqual({ resourceCount: 2, scope: "resource", size: 2 ** 41 });
  });
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
