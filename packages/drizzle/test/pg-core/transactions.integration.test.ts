import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createPostgresRepositories } from "../../src/pg-core/repositories.js";
import { createPostgresServerAdapters } from "../../src/pg-core/server.js";
import { newAsset, newResource } from "../support/fixtures.js";
import { pathFromUrl } from "../support/paths.js";

const migrationsFolder = pathFromUrl(new URL("../../migrations/pg", import.meta.url));

const connect = async () => {
  const client = new PGlite();
  const db = drizzle(client);

  await migrate(db, { migrationsFolder });

  const repositories = createPostgresRepositories(db);

  return { adapters: createPostgresServerAdapters(db), client, repositories };
};

type ExampleRepositories = Awaited<ReturnType<typeof connect>>["repositories"];

/** Fails when a call never settles, instead of letting the test time out with no message. */
const settleWithin = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`The transaction did not settle within ${ms}ms.`)), ms),
    ),
  ]);

/** The shape the services hand the transaction runner: the handles, and the flag they assert on. */
const serviceContext = (repositories: ExampleRepositories) => ({
  assetRepo: repositories.assets,
  isInTransaction: false,
  resourceRepo: repositories.resources,
  uploadSessionRepo: repositories.uploadSessions,
});

/**
 * A resource resolve reads the resources, then the assets they point at, both inside one
 * transaction. On pglite that second read never settles, so the pieces are exercised here on their
 * own, to tell a driver limitation apart from the way the service composes them.
 */
describe("reading through two repositories in one transaction", () => {
  let connection: Awaited<ReturnType<typeof connect>>;

  beforeAll(async () => {
    connection = await connect();
  });

  afterAll(() => connection.client.close());

  test("reads a resource, then the asset it points at", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const resource = await connection.repositories.resources.insert(
      newResource({ assetId: asset.id }),
    );

    const found = await connection.adapters.transaction(
      serviceContext(connection.repositories),
      async (context) => {
        const [row] = await context.resourceRepo.findByIds([resource.id]);
        if (!row) throw new Error("Expected the resource to be there.");

        const [itsAsset] = await context.assetRepo.findByIds([row.assetId]);

        return itsAsset;
      },
    );

    expect(found?.id).toBe(asset.id);
  });

  test("reads the same repository twice", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const resource = await connection.repositories.resources.insert(
      newResource({ assetId: asset.id }),
    );

    const found = await connection.adapters.transaction(
      serviceContext(connection.repositories),
      async (context) => {
        const [first] = await context.resourceRepo.findByIds([resource.id]);
        const [second] = await context.resourceRepo.findByIds([resource.id]);

        return [first, second];
      },
    );

    expect(found.map((row) => row?.id)).toEqual([resource.id, resource.id]);
  });

  test("reads both with no transaction at all", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const resource = await connection.repositories.resources.insert(
      newResource({ assetId: asset.id }),
    );

    const [row] = await connection.repositories.resources.findByIds([resource.id]);
    if (!row) throw new Error("Expected the resource to be there.");

    const [itsAsset] = await connection.repositories.assets.findByIds([row.assetId]);

    expect(itsAsset?.id).toBe(asset.id);
  });

  // The services call one transaction from inside another (a resolve is transactional, and the
  // asset join runs through a sibling service), so the nesting has to work too.
  test("reads through two repositories inside a nested transaction", async () => {
    const asset = await connection.repositories.assets.insert(newAsset());
    const resource = await connection.repositories.resources.insert(
      newResource({ assetId: asset.id }),
    );

    const found = await settleWithin(
      connection.adapters.transaction(serviceContext(connection.repositories), (outer) =>
        connection.adapters.transaction(outer, async (inner) => {
          const [row] = await inner.resourceRepo.findByIds([resource.id]);
          if (!row) throw new Error("Expected the resource to be there.");

          const [itsAsset] = await inner.assetRepo.findByIds([row.assetId]);

          return itsAsset;
        }),
      ),
      2_000,
    );

    expect(found?.id).toBe(asset.id);
  }, 10_000);
});
