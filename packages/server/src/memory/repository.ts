import equal from "fast-deep-equal";
import { v4 } from "uuid";

import {
  AbstractSuitcaseRepository,
  type SuitcaseDto,
  type SuitcaseDtoFilter,
  type SuitcaseInsert,
  type SuitcaseRepositoryContext,
} from "../repository.js";

/** Every row the backend holds, keyed by entity. */
export type MemoryStore = Map<string, SuitcaseDto[]>;

export interface MemoryRepositoryContext extends SuitcaseRepositoryContext {
  readonly store: MemoryStore;
}

/**
 * Matches every key of the filter. An array value matches any of its members; everything else is
 * compared by value, the way a json column compares it, so a filter on an object column such as
 * `owner` or `metadata` matches the stored row rather than one particular object instance.
 */
const matches = (row: SuitcaseDto, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([key, expected]) =>
    Array.isArray(expected)
      ? expected.some((entry) => equal(row[key], entry))
      : equal(row[key], expected),
  );

/**
 * Runs `work` and restores the rows when it throws, so one use case commits or
 * fails as a unit.
 *
 * Rows are replaced, never mutated in place, so a shallow copy of each list is
 * enough to restore.
 */
async function withRollback<T>(store: MemoryStore, work: () => Promise<T>): Promise<T> {
  const snapshot = new Map([...store].map(([entity, rows]) => [entity, [...rows]]));

  try {
    return await work();
  } catch (error) {
    // An entity first written inside the transaction has no snapshot to restore.
    for (const entity of store.keys()) {
      if (!snapshot.has(entity)) store.delete(entity);
    }
    for (const [entity, rows] of snapshot) store.set(entity, rows);
    throw error;
  }
}

/**
 * A backend that keeps every row in memory: the reference implementation of the
 * repository contract, and the option to reach for when a database is overkill
 * — prototyping, a local dev server, or a test that needs real service behaviour
 * without infrastructure.
 *
 * State lives only as long as the instance does; nothing is durable or shared
 * between processes.
 *
 * A rollback restores the rows wholesale, so — unlike postgres, where a failed
 * statement poisons the transaction until it ends — a scope here can carry on
 * after one error. Code that relies on that will pass here and on sqlite, and
 * fail on postgres.
 */
export class MemoryRepository<TType extends SuitcaseDto> extends AbstractSuitcaseRepository<
  TType,
  MemoryRepositoryContext
> {
  constructor(
    store: MemoryStore,
    private readonly entity: string,
    private readonly createId: () => string = v4,
  ) {
    super({ store, isInTransaction: false }, (context, work) =>
      withRollback(context.store, () => work({ store: context.store, isInTransaction: true })),
    );
  }

  private get rows(): TType[] {
    return (this.context.store.get(this.entity) ?? []) as TType[];
  }

  async findMany(filter: SuitcaseDtoFilter<TType>): Promise<TType[]> {
    return this.rows.filter((row) => matches(row, filter as Record<string, unknown>));
  }

  async insert(dto: SuitcaseInsert<TType>): Promise<TType> {
    const row = { ...dto, id: dto.id ?? this.createId() } as TType;
    this.context.store.set(this.entity, [...this.rows, row]);

    return row;
  }

  async patchWhere(
    filter: SuitcaseDtoFilter<TType>,
    dto: Partial<Omit<TType, "id">>,
  ): Promise<TType[]> {
    const patched = new Map(
      this.rows
        .filter((row) => matches(row, filter as Record<string, unknown>))
        .map((row) => [row.id, { ...row, ...dto } as TType]),
    );

    this.context.store.set(
      this.entity,
      this.rows.map((row) => patched.get(row.id) ?? row),
    );

    return [...patched.values()];
  }

  async deleteWhere(filter: SuitcaseDtoFilter<TType>): Promise<TType[]> {
    const removed = this.rows.filter((row) => matches(row, filter as Record<string, unknown>));
    const removedIds = new Set(removed.map((row) => row.id));

    this.context.store.set(
      this.entity,
      this.rows.filter((row) => !removedIds.has(row.id)),
    );

    return removed;
  }

  protected idFilter(ids: string[]): SuitcaseDtoFilter<TType> {
    return { id: ids } as SuitcaseDtoFilter<TType>;
  }
}
