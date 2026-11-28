import type { EntityFilter, EntityInsert } from "@softzweig/spindle-core/repository";
import {
  type MemoryStore,
  MemoryRepository as SpindleMemoryRepository,
} from "@softzweig/spindle-memory";
import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";
import type {
  SuitcaseResourceUsage,
  SuitcaseUploadUsage,
} from "@softzweig/suitcase-core/contracts";
import equal from "fast-deep-equal";
import { v4 } from "uuid";
import type { SuitcaseDto } from "../repository.js";

/**
 * A repository over rows held in process memory, built on Spindle's in-memory repository.
 *
 * The filter semantics are Suitcase's: an array value matches any of its members, and an object
 * column such as `owner` or `metadata` is compared by value rather than by instance, so a filter
 * on it matches the stored row the way a json column does.
 *
 * @human
 */
export class MemoryRepository<
  TType extends SuitcaseDto,
  TFilter extends EntityFilter<TType> = EntityFilter<TType>,
> extends SpindleMemoryRepository<TType, TFilter> {
  constructor(
    store: MemoryStore<TType>,
    private readonly createId: () => string = v4,
  ) {
    super({ read: (entity) => entity.id }, store);
  }

  override async insert(dto: EntityInsert<TType>): Promise<TType> {
    return super.insert({ ...dto, id: dto.id ?? this.createId() });
  }

  /**
   * Patches every matching row in one synchronous step.
   *
   * The read and the write must not be separated by an `await`: a compare-and-set built on
   * `patchWhere` (locking an upload session, claiming an asset) relies on the decision and the
   * write being atomic, the way a single SQL `update ... where` is.
   */
  override async patchWhere(
    filter: Readonly<TFilter>,
    patch: Partial<Omit<TType, "id">>,
  ): Promise<TType[]> {
    if (!hasClause(filter)) return [];

    return this.matching(filter).map((row) => this.store.set({ ...row, ...patch } as TType));
  }

  /** Deletes every matching row in one synchronous step, for the same reason as {@link patchWhere}. */
  override async deleteWhere(filter: Readonly<TFilter>): Promise<TType[]> {
    if (!hasClause(filter)) return [];

    return this.matching(filter).flatMap(({ id }) => this.store.delete(id) ?? []);
  }

  /** The rows matching `filter`, read in one go and never mutated in place. */
  private matching(filter: Readonly<TFilter>): TType[] {
    return this.store.all.filter((row) => this.matches(row, filter));
  }

  protected override matches(entity: TType, filter: Readonly<TFilter>): boolean {
    return Object.entries(filter).every(([property, expected]) => {
      // `limit` is the row count `findMany` applies, not a clause.
      if (property === "limit" || expected === undefined) return true;

      const actual = (entity as Record<string, unknown>)[property];

      if (expected === null) return actual == null;

      return Array.isArray(expected)
        ? expected.some((entry) => equal(actual, entry))
        : equal(actual, expected);
    });
  }
}

/** Whether `filter` carries at least one clause; an undefined value is not one. */
function hasClause(filter: Readonly<Record<string, unknown>>): boolean {
  return Object.values(filter).some((value) => value !== undefined);
}

/** The resource repository, which adds up the size of the assets its rows point at. */
export class MemoryResourceRepository extends MemoryRepository<Resource> {
  constructor(
    store: MemoryStore<Resource>,
    private readonly assets: MemoryStore<Asset>,
    createId: () => string = v4,
  ) {
    super(store, createId);
  }

  async aggregateUsage(filter: EntityFilter<Resource>): Promise<SuitcaseResourceUsage> {
    const resources = await this.findMany(filter);
    const stored = this.assets.all;

    // A resource keeps no size of its own; two resources on one asset each count its bytes.
    const size = resources.reduce((total, resource) => {
      const asset = stored.find((row) => row.id === resource.assetId);
      return total + (asset?.size ?? 0);
    }, 0);

    return { resourceCount: resources.length, scope: "resource", size };
  }
}

/** The upload session repository, which adds up the bytes the matching sessions reserve. */
export class MemoryUploadSessionRepository extends MemoryRepository<UploadSession> {
  async aggregateUsage(filter: EntityFilter<UploadSession>): Promise<SuitcaseUploadUsage> {
    const sessions = await this.findMany(filter);

    return {
      scope: "upload",
      size: sessions.reduce((total, session) => total + session.size, 0),
      uploadCount: sessions.length,
    };
  }
}
