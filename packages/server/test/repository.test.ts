import { describe, expect, it } from "vitest";

import {
  AbstractSuitcaseRepository,
  type SuitcaseDtoFilter,
  type SuitcaseRepositoryContext,
} from "../src/repository.js";

type Row = { readonly id: string; readonly name: string };

type RowFilter = SuitcaseDtoFilter<Row>;

/** A repository over an in-memory array, recording every query it receives. */
const createRepository = (rows: readonly Row[]) => {
  const queries: RowFilter[] = [];

  class RowRepository extends AbstractSuitcaseRepository<
    Row,
    SuitcaseRepositoryContext,
    RowFilter
  > {
    constructor() {
      // There is no executor to rebind, so the runner only flips the flag.
      super({ isInTransaction: false }, (_context, work) => work({ isInTransaction: true }));
    }

    protected idFilter(ids: string[]): RowFilter {
      return { id: ids };
    }

    async findMany(filter: RowFilter): Promise<Row[]> {
      queries.push(filter);

      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id));
    }

    insert(dto: Row): Promise<Row> {
      return Promise.resolve(dto);
    }

    async patchWhere(filter: RowFilter, dto: Partial<Omit<Row, "id">>): Promise<Row[]> {
      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id)).map((row) => ({ ...row, ...dto }));
    }

    override patch(id: string, dto: Partial<Omit<Row, "id">>): Promise<Row> {
      return Promise.resolve({ id, name: dto.name ?? id });
    }

    async deleteWhere(filter: RowFilter): Promise<Row[]> {
      const ids = filter.id === undefined ? [] : ([] as string[]).concat(filter.id);

      return rows.filter((row) => ids.includes(row.id));
    }
  }

  return { repository: new RowRepository(), queries };
};

const rows: readonly Row[] = [
  { id: "a_1", name: "first" },
  { id: "a_2", name: "second" },
];

describe("AbstractSuitcaseRepository", () => {
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

  it("reports the transactional context inside a transaction", async () => {
    const { repository } = createRepository(rows);

    await expect(repository.transaction(async (context) => context.isInTransaction)).resolves.toBe(
      true,
    );
  });
});
