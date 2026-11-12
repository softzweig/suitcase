import {
  AbstractSuitcaseRepository,
  type SuitcaseDtoFilter,
} from "@softzweig/suitcase-server/repository";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";

import {
  AbstractDrizzleRepository,
  type DrizzleContext,
  type DrizzleDatabase,
} from "../src/repository.js";

const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
});

type AssetRow = typeof assets.$inferSelect;

type Asset = {
  readonly id: string;
  readonly key: string;
  readonly size: number;
};

type AssetFilter = SuitcaseDtoFilter<Asset>;

class AssetRepository extends AbstractDrizzleRepository<Asset, typeof assets, AssetFilter> {
  readonly table = assets;

  protected toDto(row: AssetRow): Asset {
    return { id: row.id, key: row.key, size: row.size };
  }

  protected toRow(dto: Partial<Omit<Asset, "id">>): Partial<AssetRow> {
    return { key: dto.key, size: dto.size };
  }

  protected idFilter(ids: string[]): AssetFilter {
    return { id: ids };
  }
}

/** A repository over a pg-proxy connection, recording the SQL it emits. */
const createRepository = (rows: readonly AssetRow[]) => {
  const queries: { sql: string; params: unknown[] }[] = [];

  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });

    // pg-proxy reads rows positionally, in the order of the selected columns.
    return { rows: rows.map((row) => [row.id, row.key, row.size]) };
  });

  return { repository: new AssetRepository(db), queries };
};

/**
 * A database double that records which executor each statement ran on.
 *
 * The proxy drivers cannot run transactions, so this is how the tests observe that
 * `transaction` rebinds the repository onto the transaction handle.
 */
const createRecordingDatabase = (calls: string[], executor = "pool"): DrizzleDatabase => {
  const record = (statement: string) => {
    calls.push(`${statement}@${executor}`);

    return Promise.resolve([{ id: "a_1", key: "assets/a.png", size: 42 }]);
  };

  return {
    select: () => ({ from: () => ({ where: () => record("select") }) }),
    insert: () => ({ values: () => ({ returning: () => record("insert") }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => record("update") }) }) }),
    delete: () => ({ where: () => ({ returning: () => record("delete") }) }),
    transaction: async (callback) => {
      calls.push("begin");

      const result = await callback(createRecordingDatabase(calls, "transaction"));

      calls.push("commit");

      return result;
    },
  };
};

const rows: readonly AssetRow[] = [{ id: "a_1", key: "assets/a.png", size: 42 }];

describe("AbstractDrizzleRepository", () => {
  describe("reads", () => {
    it("selects through the table and maps rows to DTOs", async () => {
      const { repository } = createRepository(rows);

      await expect(repository.findMany({})).resolves.toEqual([
        { id: "a_1", key: "assets/a.png", size: 42 },
      ]);
    });

    it("reads a row by id through the id filter", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.findById("a_1");

      expect(queries[0]?.sql).toContain('from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($1)');
      expect(queries[0]?.params).toEqual(["a_1"]);
    });

    it("reads many rows with an in clause", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.findByIds(["a_1", "a_2"]);

      expect(queries[0]?.sql).toContain('"assets"."id" in ($1, $2)');
      expect(queries[0]?.params).toEqual(["a_1", "a_2"]);
    });

    it("maps array filter values to an in clause", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.findMany({ key: ["assets/a.png"] });

      expect(queries[0]?.sql).toContain('"assets"."key" in ($1)');
    });

    it("maps scalar filter values to an equality clause", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.findMany({ size: 42 });

      expect(queries[0]?.sql).toContain('"assets"."size" = $1');
      expect(queries[0]?.params).toEqual([42]);
    });

    it("rejects a filter property without a column", async () => {
      const { repository } = createRepository(rows);

      await expect(repository.findMany({ nope: "x" } as unknown as AssetFilter)).rejects.toThrow(
        TypeError,
      );
    });

    it("does not query for an empty id list", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(repository.findByIds([])).resolves.toEqual([]);
      expect(queries).toEqual([]);
    });
  });

  describe("writes", () => {
    it("inserts and maps the returned row", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(
        repository.insert({ id: "a_1", key: "assets/a.png", size: 42 }),
      ).resolves.toEqual({ id: "a_1", key: "assets/a.png", size: 42 });

      expect(queries[0]?.sql).toContain('insert into "assets"');
      expect(queries[0]?.params).toEqual(["assets/a.png", 42]);
    });

    it("patches by id and maps the returned row", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(repository.patch("a_1", { size: 64 })).resolves.toEqual({
        id: "a_1",
        key: "assets/a.png",
        size: 42,
      });

      expect(queries[0]?.sql).toContain('update "assets" set');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($2)');
      expect(queries[0]?.params).toEqual([64, "a_1"]);
    });

    it("patches every row matching a filter", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(repository.patchWhere({ size: 42 }, { size: 64 })).resolves.toEqual([
        { id: "a_1", key: "assets/a.png", size: 42 },
      ]);

      expect(queries).toHaveLength(1);
      expect(queries[0]?.sql).toContain('update "assets" set');
      expect(queries[0]?.sql).toContain('"assets"."size" = $2');
      expect(queries[0]?.params).toEqual([64, 42]);
    });

    it("does not patch when the filter is empty", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(repository.patchWhere({}, { size: 64 })).resolves.toEqual([]);

      expect(queries).toEqual([]);
    });

    it("deletes by ids", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.delete(["a_1", "a_2"]);

      expect(queries[0]?.sql).toContain('delete from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."id" in ($1, $2)');
      expect(queries[0]?.params).toEqual(["a_1", "a_2"]);
    });

    it("deletes every row matching a filter and returns them", async () => {
      const { repository, queries } = createRepository(rows);

      await expect(repository.deleteWhere({ size: 42 })).resolves.toEqual([
        { id: "a_1", key: "assets/a.png", size: 42 },
      ]);

      expect(queries[0]?.sql).toContain('delete from "assets"');
      expect(queries[0]?.sql).toContain('"assets"."size" = $1');
      expect(queries[0]?.sql).toContain("returning");
      expect(queries[0]?.params).toEqual([42]);
    });

    it("does not query when deleting nothing", async () => {
      const { repository, queries } = createRepository(rows);

      await repository.delete([]);
      await expect(repository.deleteWhere({})).resolves.toEqual([]);

      expect(queries).toEqual([]);
    });
  });

  it("builds on the server abstraction", async () => {
    const { repository } = createRepository(rows);

    expect(repository).toBeInstanceOf(AbstractSuitcaseRepository);
  });

  describe("transactions", () => {
    it("runs the callback against a transactional copy of the repository", async () => {
      const calls: string[] = [];
      const repository = new AssetRepository(createRecordingDatabase(calls));
      let received: DrizzleContext | undefined;

      await repository.transaction(async function (context) {
        received = context;

        await this.insert({ id: "a_2", key: "assets/b.png", size: 7 });
      });

      expect(received?.isTransactional).toBe(true);
      expect(calls).toEqual(["begin", "insert@transaction", "commit"]);
    });

    it("binds a sibling repository onto the same transaction", async () => {
      const calls: string[] = [];
      const db = createRecordingDatabase(calls);

      await new AssetRepository(db).transaction(async (context) => {
        await new AssetRepository(db)
          .withContext(context)
          .insert({ id: "a_3", key: "assets/c.png", size: 9 });
      });

      expect(calls).toEqual(["begin", "insert@transaction", "commit"]);
    });
  });
});
