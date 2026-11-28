import type { EntityFilter, EntityInsert } from "@softzweig/spindle-core/repository";
import type { DrizzleDatabase } from "@softzweig/spindle-drizzle";
import type { Resource, UploadSession } from "@softzweig/suitcase-core";
import type {
  SuitcaseResourceUsage,
  SuitcaseUploadUsage,
} from "@softzweig/suitcase-core/contracts";
import type { SuitcaseDto } from "@softzweig/suitcase-server/repository";
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { AbstractDrizzleRepository } from "../repository.js";
import { tables } from "./schema.js";

/**
 * SQLite binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity. It differs from its Postgres counterpart only in the
 * table constraint.
 */
export class SqliteRepository<
  TType extends SuitcaseDto,
  TTable extends SQLiteTable,
  TFilter extends EntityFilter<TType, SQL> = EntityFilter<TType, SQL>,
> extends AbstractDrizzleRepository<TTable, TType, TFilter> {
  static of<TTable extends SQLiteTable>(db: DrizzleDatabase, table: TTable) {
    return new SqliteRepository<SuitcaseDto & InferSelectModel<TTable>, TTable>(db, table);
  }

  protected toDto(row: InferSelectModel<TTable>): TType {
    return row as TType;
  }

  protected toRow(dto: Readonly<Partial<EntityInsert<TType>>>): Partial<InferInsertModel<TTable>> {
    // The DTO is the row by construction, so no field mapping happens here.
    return dto as unknown as Partial<InferInsertModel<TTable>>;
  }

  idFilter(ids: readonly string[]): TFilter {
    return { id: [...ids] } as TFilter;
  }
}

/**
 * The resource repository. A resource row carries no size, so its usage joins the asset it points
 * at and adds that up: one statement, one row back, whatever the owner holds.
 */
export class SqliteResourceRepository extends SqliteRepository<
  Resource,
  typeof tables.resources,
  EntityFilter<Resource, SQL>
> {
  constructor(db: DrizzleDatabase) {
    super(db, tables.resources);
  }

  async aggregateUsage(filter: EntityFilter<Resource, SQL>): Promise<SuitcaseResourceUsage> {
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
  typeof tables.uploadSessions,
  EntityFilter<UploadSession, SQL>
> {
  constructor(db: DrizzleDatabase) {
    super(db, tables.uploadSessions);
  }

  async aggregateUsage(filter: EntityFilter<UploadSession, SQL>): Promise<SuitcaseUploadUsage> {
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
