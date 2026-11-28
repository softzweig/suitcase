import type {
  Entity,
  EntityFilter,
  Repository,
  RepositoryContext,
} from "@softzweig/spindle-core/repository";
import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";
import type {
  SuitcaseResourceUsage,
  SuitcaseUploadUsage,
} from "@softzweig/suitcase-core/contracts";

/**
 * The repositories a Suitcase server needs, bound to the same context.
 *
 * @human
 */
export interface SuitcaseRepositories<TContext extends RepositoryContext = RepositoryContext> {
  readonly assets: AssetRepository<TContext>;
  readonly resources: ResourceRepository<TContext>;
  readonly uploadSessions: UploadSessionRepository<TContext>;
}

/** The asset storage of a backend. @see {@link Asset} */
export type AssetRepository<TContext extends RepositoryContext = RepositoryContext> = Repository<
  Asset,
  TContext
>;

/** A resource repository also answers how much storage an owner holds. */
export type ResourceRepository<TContext extends RepositoryContext = RepositoryContext> = Repository<
  Resource,
  TContext
> & {
  aggregateUsage(filter: EntityFilter<Resource>): Promise<SuitcaseResourceUsage>;
};

/** An upload session repository also answers how many bytes are reserved for an owner. */
export type UploadSessionRepository<TContext extends RepositoryContext = RepositoryContext> =
  Repository<UploadSession, TContext> & {
    aggregateUsage(filter: EntityFilter<UploadSession>): Promise<SuitcaseUploadUsage>;
  };

/** Every entity a Suitcase backend stores is identified by a string. */
export type SuitcaseDto = Entity & { id: string };
