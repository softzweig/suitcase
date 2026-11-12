import type {
  SuitcaseDto,
  SuitcaseDtoFilter,
  SuitcaseInsert,
} from "@softzweig/suitcase-server/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { AbstractDrizzleRepository, type DrizzleDatabase } from "../repository.js";
import { tables } from "./schema.js";

/**
 * Postgres binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity and the column map is derived from the table.
 *
 * One generic class replaces a subclass per entity: the table is the only thing
 * an entity has to supply, and `withContext` is inherited rather than overridden.
 */
export class PostgresRepository<
  TType extends SuitcaseDto,
  TTable extends PgTable,
> extends AbstractDrizzleRepository<TType, TTable, SuitcaseDtoFilter<TType, SQL>> {
  constructor(
    db: DrizzleDatabase,
    readonly table: TTable,
  ) {
    super(db);
  }

  static of<TTable extends PgTable>(db: DrizzleDatabase, table: TTable) {
    return new PostgresRepository<SuitcaseDto & InferSelectModel<TTable>, TTable>(db, table);
  }

  protected toDto(row: InferSelectModel<TTable>): TType {
    return row as TType;
  }

  protected toRow(dto: Partial<SuitcaseInsert<TType>>): Partial<InferInsertModel<TTable>> {
    // The DTO is the row by construction, so no field mapping happens here.
    return dto as unknown as Partial<InferInsertModel<TTable>>;
  }

  protected idFilter(ids: string[]): SuitcaseDtoFilter<TType, SQL> {
    return { id: ids } as SuitcaseDtoFilter<TType, SQL>;
  }
}

/** Wires the three repositories against one database connection. */
export const createPostgresRepositories = (db: DrizzleDatabase) => ({
  assets: PostgresRepository.of(db, tables.assets),
  resources: PostgresRepository.of(db, tables.resources),
  uploadSessions: PostgresRepository.of(db, tables.uploadSessions),
});
