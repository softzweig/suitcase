import type { SuitcaseDto, SuitcaseDtoFilter } from "@softzweig/suitcase-server/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { AbstractDrizzleRepository, type DrizzleDatabase } from "../repository.js";
import { tables } from "./schema.js";

/**
 * SQLite binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity and the column map is derived from the table.
 *
 * One generic class replaces a subclass per entity: the table is the only thing
 * an entity has to supply. `SqliteRepository` differs from its Postgres
 * counterpart only in the table constraint.
 */
export class SqliteRepository<
  TType extends SuitcaseDto,
  TTable extends SQLiteTable,
> extends AbstractDrizzleRepository<TType, TTable, SuitcaseDtoFilter<TType, SQL>> {
  constructor(
    db: DrizzleDatabase,
    readonly table: TTable,
  ) {
    super(db);
  }

  static of<TTable extends SQLiteTable>(db: DrizzleDatabase, table: TTable) {
    return new SqliteRepository<SuitcaseDto & InferSelectModel<TTable>, TTable>(db, table);
  }

  protected toDto(row: InferSelectModel<TTable>): TType {
    return row as TType;
  }

  protected toRow(dto: Partial<Omit<TType, "id">>): Partial<InferInsertModel<TTable>> {
    // The DTO is the row by construction, so no field mapping happens here.
    return dto as unknown as Partial<InferInsertModel<TTable>>;
  }

  protected idFilter(ids: string[]): SuitcaseDtoFilter<TType, SQL> {
    return { id: ids } as SuitcaseDtoFilter<TType, SQL>;
  }
}

/** Wires the three repositories against one database connection. */
export const createSqliteRepositories = (db: DrizzleDatabase) => ({
  assets: SqliteRepository.of(db, tables.assets),
  resources: SqliteRepository.of(db, tables.resources),
  uploadSessions: SqliteRepository.of(db, tables.uploadSessions),
});
