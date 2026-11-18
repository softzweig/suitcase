import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";

import {
  BaseTransactional,
  type Transactional,
  type TransactionalContext,
} from "./transactional.js";

export interface SuitcaseRepositories<
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
> {
  readonly assets: AssetRepository<TContext>;
  readonly resources: ResourceRepository<TContext>;
  readonly uploadSessions: UploadSessionRepository<TContext>;
}

/** @see {@link Asset}, {@link SuitcaseRepository} */
export type AssetRepository<
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
> = SuitcaseRepository<Asset, TContext>;

/** @see {@link Resource}, {@link SuitcaseRepository} */
export type ResourceRepository<
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
> = SuitcaseRepository<Resource, TContext>;

/** @see {@link UploadSession}, {@link SuitcaseRepository} */
export type UploadSessionRepository<
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
> = SuitcaseRepository<UploadSession, TContext>;

/**
 * What a repository hands a transaction callback, and what a service can assert on.
 *
 * `isInTransaction` is `true` only inside {@link SuitcaseRepository.transaction},
 * so a service can require being part of one, or refuse to run in one, instead
 * of guessing from the call site.
 */
export type SuitcaseRepositoryContext = TransactionalContext;

export type SuitcaseDto = Record<string, unknown> & {
  id: string; // Every entity/DTO in suitcase must have a unique string identifier
};

/**
 * A DTO being created: the id may be omitted and left to the backend, which then
 * has to generate one.
 */
export type SuitcaseInsert<TType extends SuitcaseDto> = Omit<TType, "id"> & { id?: string };

export type SuitcaseDtoFilter<TDto extends SuitcaseDto, TExtension = never> = {
  [K in keyof TDto]?: TDto[K] | TDto[K][] | TExtension;
};

/**
 * Base interface for all repositories in Suitcase, providing standard CRUD operations.
 *
 * This is essentially our database abstraction layer, with a consistent interface that
 * generalizes database (or for that matter: backend) interactions into a uniform API.
 *
 * #### Design Decisions
 * This was one of the core decisions, making sure other than Stratforge, Suitcase
 * is fully storage- and database-agnostic. No forced Drizzle, SQL or any backend type.
 * You can literally plug in whatever database or backend you prefer.
 *
 * #### Building custom repositories
 * It's however of utmost importance to implement the core methods correctly.
 * The `@softzweig/suitcase-drizzle` package contains ready-made implementations for
 * Drizzle-based backends, where you get fully functional repositories that are scalable,
 * with indexes prebuilt into the schemas; have a look in case you want to implement
 * your own repositories or extend Suitcase's functionality.
 *
 * @human
 */
export interface SuitcaseRepository<
  TType extends SuitcaseDto,
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
  TFilter extends SuitcaseDtoFilter<TType> = SuitcaseDtoFilter<TType>,
> extends Transactional<TContext> {
  // Lookups

  /** Finds an entity by its unique identifier. Returns `null` if not found. */
  findById(id: string): Promise<TType | null>;

  /** Finds entities by their unique identifiers. */
  findByIds(ids: readonly string[]): Promise<TType[]>;

  /** Finds entities matching the given filter. */
  findMany(filter: TFilter): Promise<TType[]>;

  /** Finds a single entity matching the given filter. Returns `null` if not found. */
  findOne(filter: TFilter): Promise<TType | null>;

  // Mutations

  /** Inserts a new entity, generating the id when it is not supplied. */
  insert(dto: SuitcaseInsert<TType>): Promise<TType>;

  /** Patches an entity by its unique identifier. */
  patch(id: string, dto: Partial<Omit<TType, "id">>): Promise<TType>;

  /** Patches entities matching the given filter. */
  patchWhere(filter: TFilter, dto: Partial<Omit<TType, "id">>): Promise<TType[]>;

  /** Deletes entities by their unique identifiers. */
  delete(ids: readonly string[]): Promise<TType[]>;

  /** Deletes entities matching the given filter. */
  deleteWhere(filter: TFilter): Promise<TType[]>;
}

/**
 * Base for every repository: implements the id lookups once, in terms of
 * {@link findMany}, so an adapter only has to describe how to query a set of rows.
 *
 * `findMany`, `insert`, `patchWhere` and `deleteWhere` stay abstract, they are the
 * parts that genuinely differ per backend; the transaction plumbing comes from
 * {@link BaseTransactional}.
 */
export abstract class AbstractSuitcaseRepository<
    TType extends SuitcaseDto,
    TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
    // biome-ignore lint/suspicious/noExplicitAny: We need `any` here to allow e.g. SQL extension
    TFilter extends SuitcaseDtoFilter<TType, any> = SuitcaseDtoFilter<TType>,
  >
  extends BaseTransactional<TContext>
  implements SuitcaseRepository<TType, TContext, TFilter>
{
  /** The only read an adapter must implement; the lookups below build on it. */
  abstract findMany(filter: TFilter): Promise<TType[]>;
  abstract insert(dto: SuitcaseInsert<TType>): Promise<TType>;
  abstract patchWhere(filter: TFilter, dto: Partial<Omit<TType, "id">>): Promise<TType[]>;
  abstract deleteWhere(filter: TFilter): Promise<TType[]>;

  /**
   * Turns a set of ids into a filter the backend understands.
   *
   * Kept abstract because `TFilter` may carry required fields beyond `id`, so the
   * base class cannot construct one itself.
   */
  protected abstract idFilter(ids: string[]): TFilter;

  async patch(id: string, dto: Partial<Omit<TType, "id">>): Promise<TType> {
    const [updated] = await this.patchWhere(this.idFilter([id]), dto);
    if (!updated) throw new Error(`Entity with id ${id} not found`);
    return updated;
  }

  /** Deletes the rows matching `ids`, through {@link deleteWhere}. */
  async delete(ids: string[]): Promise<TType[]> {
    if (ids.length === 0) return [];
    return this.deleteWhere(this.idFilter(ids));
  }

  /** First match of `filter`; `null` when nothing matches. */
  async findOne(filter: TFilter): Promise<TType | null> {
    const [found] = await this.findMany(filter);
    return found ?? null;
  }

  /** Reads a single row by id; `null` when it does not exist. */
  async findById(id: string): Promise<TType | null> {
    return this.findOne(this.idFilter([id]));
  }

  /** Reads the rows matching `ids`; unknown ids are simply absent from the result. */
  async findByIds(ids: string[]): Promise<TType[]> {
    if (ids.length === 0) return [];
    return this.findMany(this.idFilter(ids));
  }
}
