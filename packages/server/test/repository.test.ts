import {
  AbstractRepository,
  type EntityFilter,
  type EntityInsert,
  type RepositoryContext,
} from "@softzweig/spindle-core/repository";
import { describe, expect, it } from "vitest";

type Row = { readonly id: string; readonly name: string };

type RowFilter = EntityFilter<Row, never>;

/** A repository over an in-memory array, recording every query it receives. */
const createRepository = (rows: readonly Row[]) => {
  const queries: RowFilter[] = [];

  class RowRepository extends AbstractRepository<Row, RepositoryContext, RowFilter> {
    constructor() {
      // There is no executor to rebind, so the runner only flips the flag.
      super({ isInTransaction: false }, (_context, work) => work({ isInTransaction: true }), {
        read: (row) => row.id,
      });
    }

    idFilter(ids: readonly string[]): RowFilter {
      return { id: [...ids] };
    }

    async findMany(filter: Readonly<RowFilter & { limit?: number }>): Promise<Row[]> {
      queries.push(filter);

      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id));
    }

    insert(dto: EntityInsert<Row>): Promise<Row> {
      return Promise.resolve({ id: dto.id ?? "generated", name: dto.name });
    }

    async patchWhere(filter: Readonly<RowFilter>, dto: Partial<Omit<Row, "id">>): Promise<Row[]> {
      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id)).map((row) => ({ ...row, ...dto }));
    }

    override patch(id: string, dto: Partial<Omit<Row, "id">>): Promise<Row> {
      return Promise.resolve({ id, name: dto.name ?? id });
    }

    async deleteWhere(filter: Readonly<RowFilter>): Promise<Row[]> {
      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id));
    }

    protected fetchPage(
      filter: Readonly<RowFilter> | undefined,
      cursor: string | undefined,
      limit: number,
    ): Promise<Row[]> {
      const matched = rows
        .filter((row) => cursor === undefined || row.id > cursor)
        .filter((row) => filter?.id === undefined || [filter.id].flat().includes(row.id));

      return Promise.resolve(matched.slice(0, limit));
    }
  }

  return { repository: new RowRepository(), queries };
};

const rows: readonly Row[] = [
  { id: "a_1", name: "first" },
  { id: "a_2", name: "second" },
];

describe("AbstractRepository", () => {
  it("finds a row by id", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.findById("a_2")).resolves.toEqual({ id: "a_2", name: "second" });
  });

  it("returns null for an unknown id", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.findById("missing")).resolves.toBeNull();
  });

  it("finds the rows matching a set of ids", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.findByIds(["a_1", "missing"])).resolves.toEqual([rows[0]]);
  });

  it("does not query for an empty id list", async () => {
    const { repository, queries } = createRepository(rows);

    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(queries).toEqual([]);
  });

  it("asks the backend for ids through the filter", async () => {
    const { repository, queries } = createRepository(rows);

    await repository.findById("a_1");

    expect(queries).toEqual([{ id: ["a_1"] }]);
  });

  it("returns null when findOne matches nothing", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.findOne({ id: "missing" })).resolves.toBeNull();
  });

  it("reports whether anything matches a filter", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.exists({ id: "a_1" })).resolves.toBe(true);
    await expect(repository.exists({ id: "missing" })).resolves.toBe(false);
  });

  it("reports the transactional context inside a transaction", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.transaction(async (context) => context.isInTransaction)).resolves.toBe(
      true,
    );
  });

  it("pages through the rows in cursor order", async () => {
    const { repository } = createRepository(rows);

    const first = await repository.list({ limit: 1 });
    expect(first.items).toEqual([{ id: "a_1", name: "first" }]);

    const second = await repository.list({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.items).toEqual([{ id: "a_2", name: "second" }]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a page limit that is not a positive integer", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.list({ limit: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});
