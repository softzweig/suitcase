import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";

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
 * `isTransactional` is `true` only inside {@link SuitcaseRepository.transaction},
 * so a service can require being part of one — or refuse to run in one — instead
 * of guessing from the call site.
 */
export interface SuitcaseRepositoryContext {
  readonly isTransactional: boolean;
}

export type SuitcaseDto = Record<string, unknown> & {
  id: string; // Every entity/DTO in suitcase must have a unique string identifier
};

export type SuitcaseDtoFilter<TDto extends SuitcaseDto, TExtension = never> = {
  [K in keyof TDto]?: TDto[K] | TDto[K][] | TExtension;
};

export interface SuitcaseRepository<
  TType extends SuitcaseDto,
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
  TFilter extends SuitcaseDtoFilter<TType> = SuitcaseDtoFilter<TType>,
> {
  transaction<T>(callback: (this: this, context: TContext) => Promise<T>): Promise<T>;

  findById(id: string): Promise<TType | null>;
  findByIds(ids: string[]): Promise<TType[]>;
  findMany(filter: TFilter): Promise<TType[]>;
  findOne(filter: TFilter): Promise<TType | null>;

  insert(dto: TType): Promise<TType>;
  patch(id: string, dto: Partial<Omit<TType, "id">>): Promise<TType>;
  patchWhere(filter: TFilter, dto: Partial<Omit<TType, "id">>): Promise<TType[]>;
  delete(ids: string[]): Promise<void>;
  deleteWhere(filter: TFilter): Promise<TType[]>;
}

/**
 * Base for every repository: implements the id lookups once, in terms of
 * {@link findMany}, so an adapter only has to describe how to query a set of rows.
 *
 * `transaction`, `findMany`, `insert`, `patchWhere` and `deleteWhere` stay
 * abstract, they are the parts that genuinely differ per backend.
 */
export abstract class AbstractSuitcaseRepository<
  TType extends SuitcaseDto,
  TContext extends SuitcaseRepositoryContext = SuitcaseRepositoryContext,
  // biome-ignore lint/suspicious/noExplicitAny: We need `any` here to allow e.g. SQL extension
  TFilter extends SuitcaseDtoFilter<TType, any> = SuitcaseDtoFilter<TType>,
> implements SuitcaseRepository<TType, TContext, TFilter>
{
  abstract transaction<T>(callback: (this: this, context: TContext) => Promise<T>): Promise<T>;

  /** The only read an adapter must implement; the lookups below build on it. */
  abstract findMany(filter: TFilter): Promise<TType[]>;
  abstract insert(dto: TType): Promise<TType>;
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
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.deleteWhere(this.idFilter(ids));
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
