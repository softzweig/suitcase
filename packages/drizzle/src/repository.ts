import {
  AbstractSuitcaseRepository,
  type SuitcaseDto,
  type SuitcaseDtoFilter,
  type SuitcaseRepositoryContext,
} from "@softzweig/suitcase-server/repository";
import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  type SQL,
  type Table,
} from "drizzle-orm";

/** A row as returned by a statement whose table type is only known generically. */
type Row = Record<string, unknown>;

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
  constructor(protected readonly db: DrizzleDatabase) {
    super();
  }

  /** The table this repository reads and writes. */
  abstract readonly table: TTable;

  /** Maps a selected row to the domain DTO. */
  protected abstract toDto(row: InferSelectModel<TTable>): TType;

  /** Maps a DTO, or a part of it, to insertable column values. */
  protected abstract toRow(dto: Partial<Omit<TType, "id">>): Partial<InferInsertModel<TTable>>;

  /**
   * Turns ids into a filter.
   *
   * Abstract because `TFilter` may add required fields beyond `id`, so the base
   * class cannot construct one.
   */
  protected abstract override idFilter(ids: string[]): TFilter;

  /**
   * A copy of this repository bound to the context's executor.
   *
   * `transaction` hands such a copy to the callback as `this`, and services use it
   * to bind sibling repositories onto the same transaction.
   */
  withContext(context: DrizzleContext): this {
    const bound: this = Object.create(this);
    Object.defineProperty(bound, "db", { value: context.db });
    return bound;
  }

  override transaction<T>(
    callback: (this: this, context: DrizzleContext) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((tx) => {
      const context: DrizzleContext = { db: tx, isTransactional: true };
      return callback.call(this.withContext(context), context);
    });
  }

  override async findMany(filter: TFilter): Promise<TType[]> {
    return this.toDtos(await this.select(this.where(filter)));
  }

  override async insert(dto: TType): Promise<TType> {
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

  /** Translates the property filter, requiring every key to map to a column. */
  protected where(filter: TFilter): SQL | undefined {
    const columns = getTableColumns(this.table);

    return and(
      ...Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .map(([property, value]) => {
          const column = columns[property];

          if (!column) throw new TypeError(`filter property "${property}" has no column mapping`);

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
  private source(): Table {
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
