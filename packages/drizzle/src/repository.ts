import { TRANSACTION_EXECUTOR } from "@softzweig/suitcase-server";
import {
  AbstractSuitcaseRepository,
  type SuitcaseDto,
  type SuitcaseDtoFilter,
  type SuitcaseInsert,
  type SuitcaseRepositoryContext,
} from "@softzweig/suitcase-server/repository";
import {
  and,
  type Column,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNull,
  type SQL,
  sql,
  type Table,
} from "drizzle-orm";

/** A row as returned by a statement whose table type is only known generically. */
type Row = Record<string, unknown>;

/**
 * The builder an aggregate reads: drizzle's own, narrowed to the two chain steps a usage answer
 * uses. The shared `DrizzleDatabase` stays dialect-neutral and only names whole-row reads, so this
 * is reached through the cast in {@link AbstractDrizzleRepository.aggregateSum}.
 */
interface AggregateSelect extends PromiseLike<Row[]> {
  innerJoin(table: Table, on: SQL): AggregateSelect;
  where(condition: SQL | undefined): AggregateSelect;
}

/** The projection form of `select`, which every dialect's builder has. */
type ProjectingSelect = (projection: Record<string, SQL | Column>) => {
  from(table: Table): AggregateSelect;
};

/**
 * The slice of a drizzle database this package drives.
 *
 * Deliberately structural and dialect-agnostic: drizzle has no cross-dialect
 * database base type, but every `drizzle()` instance — Postgres, MySQL or
 * SQLite — satisfies this shape, and so does a transaction handle, which is why
 * it can reference itself as the transaction context.
 */
export interface DrizzleDatabase {
  select(): {
    from(table: Table): { where(condition: SQL | undefined): PromiseLike<Row[]> };
  };
  insert(table: Table): {
    values(values: Row): { returning(): PromiseLike<Row[]> };
  };
  update(table: Table): {
    set(values: Row): { where(condition: SQL): { returning(): PromiseLike<Row[]> } };
  };
  delete(table: Table): {
    where(condition: SQL): { returning(): PromiseLike<Row[]> };
  };
  transaction<T>(callback: (transaction: DrizzleDatabase) => Promise<T>): Promise<T>;
}

/** The context a drizzle repository passes to a transaction callback. */
export interface DrizzleContext extends SuitcaseRepositoryContext {
  /** The executor this context is bound to — the transaction handle. */
  readonly db: DrizzleDatabase;

  /** The same handle, in the slot a nested transaction runner reads back. */
  readonly [TRANSACTION_EXECUTOR]: DrizzleDatabase;
}

/**
 * Base for a drizzle-backed repository.
 *
 * Reads and writes are implemented once: filters become `where` clauses, rows
 * become DTOs, and `findById`/`findByIds`/`findOne` come from the server
 * abstraction. An adapter supplies the table, the two mappers and the id filter.
 */
export abstract class AbstractDrizzleRepository<
  TType extends SuitcaseDto,
  TTable extends Table,
  TFilter extends SuitcaseDtoFilter<TType, SQL>,
> extends AbstractSuitcaseRepository<TType, DrizzleContext, TFilter> {
  constructor(db: DrizzleDatabase) {
    super({ [TRANSACTION_EXECUTOR]: db, db, isInTransaction: false }, (context, work) =>
      context.db.transaction((transaction) =>
        work({ [TRANSACTION_EXECUTOR]: transaction, db: transaction, isInTransaction: true }),
      ),
    );
  }

  /** The executor this repository is bound to. */
  protected get db(): DrizzleDatabase {
    return this.context.db;
  }

  /** The table this repository reads and writes. */
  abstract readonly table: TTable;

  /** Maps a selected row to the domain DTO. */
  protected abstract toDto(row: InferSelectModel<TTable>): TType;

  /** Maps a DTO, or a part of it, to insertable column values. */
  protected abstract toRow(dto: Partial<SuitcaseInsert<TType>>): Partial<InferInsertModel<TTable>>;

  /**
   * Turns ids into a filter.
   *
   * Abstract because `TFilter` may add required fields beyond `id`, so the base
   * class cannot construct one.
   */
  protected abstract override idFilter(ids: string[]): TFilter;

  override async findMany(filter: TFilter): Promise<TType[]> {
    return this.toDtos(await this.select(this.where(filter)));
  }

  override async insert(dto: SuitcaseInsert<TType>): Promise<TType> {
    const [row] = await this.db.insert(this.source()).values(this.toRow(dto)).returning();

    if (!row) throw new TypeError("insert returned no row");

    return this.toDto(row as InferSelectModel<TTable>);
  }

  override async patchWhere(filter: TFilter, dto: Partial<Omit<TType, "id">>): Promise<TType[]> {
    const sqlFilter = this.where(filter);
    if (!sqlFilter) return [];

    const rows = await this.db
      .update(this.source())
      .set(this.toRow(dto))
      .where(sqlFilter)
      .returning();

    return this.toDtos(rows);
  }

  override async deleteWhere(filter: TFilter): Promise<TType[]> {
    const sqlFilter = this.where(filter);
    if (!sqlFilter) return [];

    const rows = await this.db.delete(this.source()).where(sqlFilter).returning();

    return this.toDtos(rows);
  }

  /**
   * Counts the rows matching `filter` and adds up `column`, in one statement.
   *
   * The database does the arithmetic, which is the whole point: a usage answer costs one row of
   * transfer however many rows it covers. `join` is for bytes that live on another table, such as
   * a resource's asset; without it the column has to be the entity's own.
   */
  protected async aggregateSum(
    filter: TFilter,
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

  /** Translates the property filter, requiring every key to map to a column. */
  protected where(filter: TFilter): SQL | undefined {
    const columns = getTableColumns(this.table);

    return and(
      ...Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .map(([property, value]) => {
          const column = columns[property];

          if (!column) throw new TypeError(`filter property "${property}" has no column mapping`);

          if (value === null) return isNull(column);

          return Array.isArray(value) ? inArray(column, value) : eq(column, value);
        }),
    );
  }

  /**
   * The table as a plain {@link Table}.
   *
   * `TTable` narrows the mapper types; handing the unresolved generic to
   * drizzle's builders trips a conditional type that only resolves for concrete
   * tables.
   */
  protected source(): Table {
    return this.table;
  }

  /** Selects rows, re-typing them from the widened table to the mapper's row type. */
  private async select(condition: SQL | undefined): Promise<InferSelectModel<TTable>[]> {
    const rows = await this.db.select().from(this.source()).where(condition);
    return rows as InferSelectModel<TTable>[];
  }

  private toDtos(rows: Row[]): TType[] {
    return rows.map((row) => this.toDto(row as InferSelectModel<TTable>));
  }
}
