import type { EntityFilter } from "@softzweig/spindle-core/repository";
import {
  type DrizzleDatabase,
  pagingById,
  AbstractDrizzleRepository as SpindleDrizzleRepository,
} from "@softzweig/spindle-drizzle";
import type { SuitcaseDto } from "@softzweig/suitcase-server/repository";
import { type Column, type SQL, sql, type Table } from "drizzle-orm";

/**
 * The builder an aggregate reads: drizzle's own, narrowed to the two chain steps a usage answer
 * uses. The shared `DrizzleDatabase` stays dialect-neutral and only names whole-row reads, so this
 * is reached through the cast in {@link AbstractDrizzleRepository.aggregateSum}.
 */
interface AggregateSelect extends PromiseLike<Record<string, unknown>[]> {
  innerJoin(table: Table, on: SQL): AggregateSelect;
  where(condition: SQL | undefined): AggregateSelect;
}

/** The projection form of `select`, which every dialect's builder has. */
type ProjectingSelect = (projection: Record<string, SQL | Column>) => {
  from(table: Table): AggregateSelect;
};

/**
 * Base for a drizzle-backed Suitcase repository: Spindle's repository, plus the one aggregate
 * Suitcase's usage endpoints need.
 *
 * Reads, writes, paging and constraint reporting come from `@softzweig/spindle-drizzle`; a
 * dialect only names its table and, when its id is not what orders its pages, its paging.
 *
 * @human
 */
export abstract class AbstractDrizzleRepository<
  TTable extends Table,
  TType extends SuitcaseDto,
  TFilter extends EntityFilter<TType, SQL> = EntityFilter<TType, SQL>,
> extends SpindleDrizzleRepository<TTable, TType, TFilter> {
  constructor(db: DrizzleDatabase, table: TTable) {
    super(db, table, pagingById<TType>(table));
  }

  /**
   * Counts the rows matching `filter` and adds up `column`, in one statement.
   *
   * The database does the arithmetic, which is the whole point: a usage answer costs one row of
   * transfer however many rows it covers. `join` is for bytes that live on another table, such as
   * a resource's asset; without it the column has to be the entity's own.
   */
  protected async aggregateSum(
    filter: Readonly<TFilter>,
    size: Readonly<{ column: Column; join?: Readonly<{ table: Table; on: SQL }> }>,
  ): Promise<{ readonly count: number; readonly size: number }> {
    // Every dialect's `select()` takes a projection, but naming it on the shared interface would
    // make the shape stricter than the databases this package drives actually are. Called on the
    // database itself, not through a variable: the builder needs its receiver. ~vz
    const from = (this.db.select as unknown as ProjectingSelect)({
      count: sql`count(*)`,
      size: sql`coalesce(sum(${size.column}), 0)`,
    }).from(this.source());
    const scoped = size.join ? from.innerJoin(size.join.table, size.join.on) : from;
    const [row] = await scoped.where(this.where(filter));

    // A driver returns `count` as a bigint string and an empty sum as null, so both are coerced
    // here rather than at every call site.
    return {
      count: Number(row?.count ?? 0),
      size: Number(row?.size ?? 0),
    };
  }
}
