import type { Asset, Resource } from "@softzweig/suitcase-core";
import { AssetStatus } from "@softzweig/suitcase-core";
import type {
  ResourceRepository,
  SuitcaseDto,
  SuitcaseRepository,
  UploadSessionRepository,
} from "@softzweig/suitcase-server/repository";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleContext } from "../../src/repository.js";
import { newAsset, newResource, newUploadSession } from "../support/fixtures.js";

type Repo<T extends SuitcaseDto> = SuitcaseRepository<T, DrizzleContext> & {
  withContext(context: DrizzleContext): SuitcaseRepository<T, DrizzleContext>;
};

export type TestDatabase = {
  readonly assets: Repo<Asset>;
  readonly resources: ResourceRepository<DrizzleContext>;
  readonly uploadSessions: UploadSessionRepository<DrizzleContext>;
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** Behavior every dialect must share, run against a real database. */
export const describeRepositories = (name: string, create: () => Promise<TestDatabase>) => {
  describe(name, () => {
    let db: TestDatabase;

    beforeAll(async () => {
      db = await create();
    });

    afterAll(async () => {
      await db.close();
    });

    beforeEach(async () => {
      await db.reset();
    });

    /** Inserts an asset, so children can reference it. */
    const givenAsset = async (overrides: Partial<Asset> = {}) => {
      const asset = newAsset(overrides);
      await db.assets.insert(asset);

      return asset;
    };

    /** A resource always has a real asset behind it, as the foreign key enforces. */
    const givenResource = async (overrides: Partial<Resource> = {}) => {
      const asset = await givenAsset();
      const row = newResource({ assetId: asset.id, ...overrides });
      await db.resources.insert(row);

      return row;
    };

    const ids = (rows: readonly { id: string }[]) => rows.map(({ id }) => id).sort();

    describe("reads", () => {
      it("finds a row by id", async () => {
        const row = await givenResource();

        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("returns null for an unknown id", async () => {
        await expect(db.resources.findById(crypto.randomUUID())).resolves.toBeNull();
      });

      it("finds one row or null", async () => {
        const row = await givenResource();

        await expect(db.resources.findOne({ fileName: row.fileName })).resolves.toEqual(row);
        await expect(db.resources.findOne({ fileName: "missing.png" })).resolves.toBeNull();
      });

      it("finds rows by ids, ignoring unknown ones", async () => {
        const a = await givenResource();
        const b = await givenResource();

        const found = await db.resources.findByIds([a.id, crypto.randomUUID(), b.id]);

        expect(ids(found)).toEqual(ids([a, b]));
      });

      it("returns no rows for an empty id list", async () => {
        await expect(db.resources.findByIds([])).resolves.toEqual([]);
      });

      it("matches nothing for an empty array filter", async () => {
        await givenResource();

        await expect(db.resources.findMany({ fileName: [] })).resolves.toEqual([]);
      });

      it("filters assets by digest fields", async () => {
        const one = newAsset({ bucket: "one" });
        const two = newAsset({ bucket: "two" });
        await db.assets.insert(one);
        await db.assets.insert(two);

        expect(ids(await db.assets.findMany({ hashAlgorithm: "sha256" }))).toEqual(ids([one, two]));
        await expect(db.assets.findMany({ bucket: "one" })).resolves.toEqual([one]);
      });

      it("filters assets by lifecycle status", async () => {
        const active = await db.assets.insert(newAsset());
        const marked = await db.assets.insert(
          newAsset({ status: AssetStatus.DELETED, deletedAt: new Date().toISOString() }),
        );

        await expect(db.assets.findMany({ status: AssetStatus.DELETED })).resolves.toEqual([
          marked,
        ]);
        await expect(db.assets.findMany({ status: AssetStatus.ACTIVE })).resolves.toEqual([active]);
      });

      it("filters by a scalar property", async () => {
        const a = await givenResource({ fileName: "a.png" });
        await givenResource({ fileName: "b.png" });

        await expect(db.resources.findMany({ fileName: "a.png" })).resolves.toEqual([a]);
      });

      it("filters by an array of values", async () => {
        const a = await givenResource({ fileName: "a.png" });
        const b = await givenResource({ fileName: "b.png" });
        await givenResource({ fileName: "c.png" });

        const found = await db.resources.findMany({ fileName: ["a.png", "b.png"] });

        expect(ids(found)).toEqual(ids([a, b]));
      });

      it("combines properties with AND", async () => {
        const matching = await givenResource({ fileName: "a.png", label: "keep" });
        await givenResource({ fileName: "a.png", label: "other" });
        await givenResource({ fileName: "b.png", label: "keep" });

        await expect(db.resources.findMany({ fileName: "a.png", label: "keep" })).resolves.toEqual([
          matching,
        ]);
      });

      it("returns all rows for an empty filter", async () => {
        const rows = [await givenResource(), await givenResource()];

        expect(ids(await db.resources.findMany({}))).toEqual(ids(rows));
      });

      it("ignores undefined filter values", async () => {
        const row = await givenResource();

        await expect(db.resources.findMany({ id: row.id, label: undefined })).resolves.toEqual([
          row,
        ]);
      });

      it("accepts sql filter values", async () => {
        const row = await givenResource({ label: "a" });
        await givenResource({ label: "b" });

        // SQL values are part of the filter type the adapters accept.
        const filter = { label: sql`'a'` } as never;

        await expect(db.resources.findMany(filter)).resolves.toEqual([row]);
      });

      it("rejects a filter property without a column", async () => {
        await expect(db.resources.findMany({ nope: "x" } as never)).rejects.toThrow(TypeError);
      });
    });

    describe("writes", () => {
      it("inserts and returns the row", async () => {
        const asset = await givenAsset();
        const row = newResource({ assetId: asset.id });

        await expect(db.resources.insert(row)).resolves.toEqual(row);
        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("generates the id when the insert omits one", async () => {
        const { id: _omitted, ...asset } = newAsset();

        const inserted = await db.assets.insert(asset);

        expect(inserted.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        await expect(db.assets.findById(inserted.id)).resolves.toEqual(inserted);
      });

      it("patches one row by id", async () => {
        const row = await givenResource();
        const patched = { ...row, label: "renamed" };

        await expect(db.resources.patch(row.id, { label: "renamed" })).resolves.toEqual(patched);
        await expect(db.resources.findById(row.id)).resolves.toEqual(patched);
      });

      it("patches several fields at once", async () => {
        const row = await givenResource();
        const dto = { label: "renamed", metadata: { tag: 1 } };

        await expect(db.resources.patch(row.id, dto)).resolves.toEqual({ ...row, ...dto });
      });

      it("rejects patching an unknown id", async () => {
        await expect(db.resources.patch(crypto.randomUUID(), { label: "x" })).rejects.toThrow();
      });

      it("patches every matching row", async () => {
        const rows = [
          await givenResource({ fileName: "shared.png" }),
          await givenResource({ fileName: "shared.png" }),
        ];

        const patched = await db.resources.patchWhere({ fileName: "shared.png" }, { label: "x" });

        expect(ids(patched)).toEqual(ids(rows));
        expect(patched.every(({ label }) => label === "x")).toBe(true);
      });

      it("does not patch when the filter is empty", async () => {
        const row = await givenResource();

        await expect(db.resources.patchWhere({}, { label: "x" })).resolves.toEqual([]);
        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("returns no rows when a patch matches nothing", async () => {
        await givenResource();

        await expect(
          db.resources.patchWhere({ fileName: "none.png" }, { label: "x" }),
        ).resolves.toEqual([]);
      });

      it("rejects an unknown patch filter property", async () => {
        await expect(
          db.resources.patchWhere({ nope: "x" } as never, { label: "x" }),
        ).rejects.toThrow(TypeError);
      });

      it("deletes rows by id", async () => {
        const row = await givenResource();
        const kept = await givenResource();

        await expect(db.resources.delete([row.id])).resolves.toEqual([row]);

        await expect(db.resources.findById(row.id)).resolves.toBeNull();
        await expect(db.resources.findById(kept.id)).resolves.toEqual(kept);
      });

      it("does nothing when deleting no ids", async () => {
        const row = await givenResource();

        await expect(db.resources.delete([])).resolves.toEqual([]);

        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("deletes every matching row and returns them", async () => {
        const row = await givenResource({ fileName: "gone.png" });
        await givenResource({ fileName: "kept.png" });

        await expect(db.resources.deleteWhere({ fileName: "gone.png" })).resolves.toEqual([row]);
        await expect(db.resources.findById(row.id)).resolves.toBeNull();
      });

      it("does not delete when the filter is empty", async () => {
        const row = await givenResource();

        await expect(db.resources.deleteWhere({})).resolves.toEqual([]);
        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("returns no rows when a delete matches nothing", async () => {
        await givenResource();

        await expect(db.resources.deleteWhere({ fileName: "none.png" })).resolves.toEqual([]);
      });

      it("rejects a duplicate primary key", async () => {
        const row = await givenResource();

        await expect(db.resources.insert(row)).rejects.toThrow();
      });

      it("enforces the asset digest and location constraints", async () => {
        const row = newAsset();
        await db.assets.insert(row);

        await expect(
          db.assets.insert(newAsset({ bucket: row.bucket, key: row.key })),
        ).rejects.toThrow();
        await expect(
          db.assets.insert(
            newAsset({
              bucket: row.bucket,
              hashHex: row.hashHex,
              hashAlgorithm: row.hashAlgorithm,
            }),
          ),
        ).rejects.toThrow();
      });

      it("scopes asset uniqueness per bucket", async () => {
        const row = newAsset();
        await db.assets.insert(row);

        // Same digest and key, different bucket: both unique indexes allow it.
        const other = { ...row, id: crypto.randomUUID(), bucket: "other" };

        await expect(db.assets.insert(other)).resolves.toEqual(other);
      });
    });

    describe("json columns", () => {
      it("round-trips resource json", async () => {
        const row = await givenResource({ label: "avatar", metadata: { source: "test" } });

        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("round-trips upload session json", async () => {
        const row = newUploadSession({ metadata: { userId: "u_1" }, resourceId: null });
        await db.uploadSessions.insert(row);

        await expect(db.uploadSessions.findById(row.id)).resolves.toEqual(row);
      });

      it("round-trips the intent the client declared", async () => {
        const row = newUploadSession({ intent: { folderId: "docs", checksum: "abc" } });
        await db.uploadSessions.insert(row);

        await expect(db.uploadSessions.findById(row.id)).resolves.toEqual(row);
      });

      it("filters upload sessions by status", async () => {
        const pending = newUploadSession({ status: "pending" });
        await db.uploadSessions.insert(pending);
        await db.uploadSessions.insert(newUploadSession({ status: "completed" }));

        await expect(db.uploadSessions.findMany({ status: "pending" })).resolves.toEqual([pending]);
      });

      it("deletes upload sessions by status", async () => {
        const completed = newUploadSession({ status: "completed" });
        const pending = newUploadSession({ status: "pending" });
        await db.uploadSessions.insert(completed);
        await db.uploadSessions.insert(pending);

        await expect(db.uploadSessions.deleteWhere({ status: "completed" })).resolves.toEqual([
          completed,
        ]);
        await expect(db.uploadSessions.findById(pending.id)).resolves.toEqual(pending);
      });

      it("allows several sessions to resolve onto one resource", async () => {
        const { id: resourceId } = await givenResource();
        const first = newUploadSession({ resourceId });
        const second = newUploadSession({ resourceId });

        await db.uploadSessions.insert(first);

        // Reuse means a later session lands on bytes an earlier one created, so the link is not
        // unique by design.
        await expect(db.uploadSessions.insert(second)).resolves.toEqual(second);
      });
    });

    describe("transactions", () => {
      it("reports the transactional context", async () => {
        const isInTransaction = await db.resources.transaction(
          async (context) => context.isInTransaction,
        );

        expect(isInTransaction).toBe(true);
      });

      it("commits writes made inside the transaction", async () => {
        const asset = await givenAsset();
        const row = newResource({ assetId: asset.id });

        await db.resources.transaction(async (context) => {
          await db.resources.withContext(context).insert(row);
        });

        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });

      it("commits writes across sibling repositories", async () => {
        const session = newUploadSession();

        await db.assets.transaction(async (context) => {
          await db.uploadSessions.withContext(context).insert(session);
        });

        await expect(db.uploadSessions.findById(session.id)).resolves.toEqual(session);
      });

      it("rolls sibling writes back with the transaction", async () => {
        const asset = await givenAsset();
        const row = newResource({ assetId: asset.id });

        await expect(
          db.resources.transaction(async (context) => {
            await db.resources.withContext(context).insert(row);
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        await expect(db.resources.findById(row.id)).resolves.toBeNull();
      });

      it("rolls back only the nested scope that failed", async () => {
        const asset = await givenAsset();
        const outer = newResource({ assetId: asset.id });
        const inner = newResource({ assetId: asset.id });

        await db.resources.transaction(async (context) => {
          await db.resources.withContext(context).insert(outer);

          await expect(
            db.resources.withContext(context).transaction(async (nested) => {
              await db.resources.withContext(nested).insert(inner);
              throw new Error("nested rollback");
            }),
          ).rejects.toThrow("nested rollback");
        });

        await expect(db.resources.findById(outer.id)).resolves.toEqual(outer);
        await expect(db.resources.findById(inner.id)).resolves.toBeNull();
      });

      it("discards the inner commits when the outer scope fails", async () => {
        const asset = await givenAsset();
        const inner = newResource({ assetId: asset.id });

        await expect(
          db.resources.transaction(async (context) => {
            await db.resources.withContext(context).transaction(async (nested) => {
              await db.resources.withContext(nested).insert(inner);
            });

            throw new Error("outer rollback");
          }),
        ).rejects.toThrow("outer rollback");

        await expect(db.resources.findById(inner.id)).resolves.toBeNull();
      });

      it("rolls patches back with the transaction", async () => {
        const row = await givenResource({ label: "before" });

        await expect(
          db.resources.transaction(async (context) => {
            await db.resources.withContext(context).patch(row.id, { label: "after" });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");

        await expect(db.resources.findById(row.id)).resolves.toEqual(row);
      });
    });
  });
};
