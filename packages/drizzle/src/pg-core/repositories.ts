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
import type { PgTable } from "drizzle-orm/pg-core";
import { AbstractDrizzleRepository } from "../repository.js";
import { tables } from "./schema.js";

/**
 * Postgres binding for entities whose DTO is exactly their table row, so both
 * mappers are the identity and the column map is derived from the table.
 *
 * One generic class replaces a subclass per entity: the table is the only thing
 * an entity has to supply.
 */
export class PostgresRepository<
  TType extends SuitcaseDto,
  TTable extends PgTable,
  TFilter extends EntityFilter<TType, SQL> = EntityFilter<TType, SQL>,
> extends AbstractDrizzleRepository<TTable, TType, TFilter> {
  static of<TTable extends PgTable>(db: DrizzleDatabase, table: TTable) {
    return new PostgresRepository<SuitcaseDto & InferSelectModel<TTable>, TTable>(db, table);
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
export class PostgresResourceRepository extends PostgresRepository<
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

    return { scope: "resource", resourceCount: count, size };
  }
}

/** The upload session repository: a session records the bytes it reserves, so it needs no join. */
export class PostgresUploadSessionRepository extends PostgresRepository<
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

    return { scope: "upload", uploadCount: count, size };
  }
}

/** Wires the three repositories against one database connection. */
export const createPostgresRepositories = (db: DrizzleDatabase) => ({
  assets: PostgresRepository.of(db, tables.assets),
  resources: new PostgresResourceRepository(db),
  uploadSessions: new PostgresUploadSessionRepository(db),
});
