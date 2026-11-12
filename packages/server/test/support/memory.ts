import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";

import { MemoryRepository, type MemoryStore } from "../../src/memory/index.js";
import type { TransactionalContext } from "../../src/transactional.js";

export interface MemoryRepositoryOptions {
  /** Generates the id of an insert that omits one. Defaults to a v4 uuid. */
  createId?: () => string;
}

export interface MemoryRepositories {
  readonly assets: MemoryRepository<Asset>;
  readonly resources: MemoryRepository<Resource>;
  readonly uploadSessions: MemoryRepository<UploadSession>;

  /** Deletes every row, so one backend can be reused across tests. */
  reset(): void;

  /**
   * The transaction runner a service needs: pass it as the service's second
   * constructor argument, and everything a use case writes is one unit of work.
   *
   * Rolls back when `work` throws.
   */
  transaction<TCtx extends TransactionalContext, T>(
    context: TCtx,
    work: (context: TCtx) => Promise<T>,
  ): Promise<T>;
}

/**
 * The three repositories sharing one store, for tests that need service
 * behaviour without a database.
 *
 * @example
 * ```ts
 * const db = createMemoryRepositories();
 * const service = new AssetService({ ...context, ... }, db.transaction);
 * ```
 */
export const createMemoryRepositories = (
  options: MemoryRepositoryOptions = {},
): MemoryRepositories => {
  const store: MemoryStore = new Map();
  const { createId } = options;

  const assets = new MemoryRepository<Asset>(store, "assets", createId);

  return {
    assets,
    resources: new MemoryRepository<Resource>(store, "resources", createId),
    uploadSessions: new MemoryRepository<UploadSession>(store, "uploadSessions", createId),
    reset: () => [...store.keys()].forEach((entity) => void store.set(entity, [])),
    // Any repository scopes a transaction over the shared store, so borrow that
    // scope rather than repeating the rollback.
    transaction: (ctx, work) => assets.transaction(() => work({ ...ctx, isInTransaction: true })),
  };
};
