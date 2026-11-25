import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresRepositories } from "../../src/pg-core/repositories.js";
import { tables } from "../../src/pg-core/schema.js";
import { describeRepositories } from "../contract/repositories.integration.js";
import { newAsset, newResource, newUploadSession } from "../support/fixtures.js";
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

/**
 * The aggregate statements, against a real database: `count(*)` and `coalesce(sum(...), 0)`
 * are the parts that cannot be checked any other way.
 */
describe("pg-core usage", () => {
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(() => connection.client.close());

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

  it("returns the sum above the 32-bit range as a number, not the driver's bigint string", async () => {
    await givenSizedResource(2 ** 30);
    await givenSizedResource(2 ** 30);

    const usage = await connection.repositories.resources.aggregateUsage({
      owner: { userId: "u_1" },
    });

    // `sum(int4)` promotes to bigint, so both this and `count(*)` arrive as strings here.
    expect(usage).toEqual({ resourceCount: 2, scope: "resource", size: 2 ** 31 });
  });
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
