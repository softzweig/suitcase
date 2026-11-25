import type { Resource, UploadSession } from "@softzweig/suitcase-core";
import type {
  SuitcaseResourceUsage,
  SuitcaseUploadUsage,
} from "@softzweig/suitcase-core/contracts";
import type {
  SuitcaseDto,
  SuitcaseDtoFilter,
  SuitcaseInsert,
} from "@softzweig/suitcase-server/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
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

  protected toRow(dto: Partial<SuitcaseInsert<TType>>): Partial<InferInsertModel<TTable>> {
    // The DTO is the row by construction, so no field mapping happens here.
    return dto as unknown as Partial<InferInsertModel<TTable>>;
  }

  protected idFilter(ids: string[]): SuitcaseDtoFilter<TType, SQL> {
    return { id: ids } as SuitcaseDtoFilter<TType, SQL>;
  }
}

/**
 * The resource repository. A resource row carries no size, so its usage joins the asset it points
 * at and adds that up: one statement, one row back, whatever the owner holds.
 */
export class SqliteResourceRepository extends SqliteRepository<Resource, typeof tables.resources> {
  constructor(db: DrizzleDatabase) {
    super(db, tables.resources);
  }

  async aggregateUsage(filter: SuitcaseDtoFilter<Resource, SQL>): Promise<SuitcaseResourceUsage> {
    const { count, size } = await this.aggregateSum(filter, {
      column: tables.assets.size,
      join: { on: eq(this.table.assetId, tables.assets.id), table: tables.assets },
    });

    return { resourceCount: count, scope: "resource", size };
  }
}

/** The upload session repository: a session records the bytes it reserves, so it needs no join. */
export class SqliteUploadSessionRepository extends SqliteRepository<
  UploadSession,
  typeof tables.uploadSessions
> {
  constructor(db: DrizzleDatabase) {
    super(db, tables.uploadSessions);
  }

  async aggregateUsage(
    filter: SuitcaseDtoFilter<UploadSession, SQL>,
  ): Promise<SuitcaseUploadUsage> {
    const { count, size } = await this.aggregateSum(filter, {
      column: this.table.size,
    });

    return { scope: "upload", size, uploadCount: count };
  }
}

/** Wires the three repositories against one database connection. */
export const createSqliteRepositories = (db: DrizzleDatabase) => ({
  assets: SqliteRepository.of(db, tables.assets),
  resources: new SqliteResourceRepository(db),
  uploadSessions: new SqliteUploadSessionRepository(db),
});
