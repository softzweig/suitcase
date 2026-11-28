import type { TransactionalContext } from "@softzweig/spindle-core/transactional";
import { TRANSACTION_EXECUTOR } from "@softzweig/spindle-core/transactional";
import { MemoryStore } from "@softzweig/spindle-memory";
import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";

import type { SuitcaseTransactionRunner } from "../server.js";
import {
  MemoryRepository,
  MemoryResourceRepository,
  MemoryUploadSessionRepository,
} from "./repository.js";

export interface MemoryRepositoryOptions {
  /** Generates the id of an insert that omits one. Defaults to a v4 uuid. */
  createId?: () => string;
}

/**
 * A Suitcase backend that keeps every row in process memory.
 *
 * Ephemeral by design: everything is gone when the process is, so this is meant for tests and
 * for wiring a server before a real store exists. The three repositories share a transaction
 * runner that snapshots all three stores, so a use case commits or fails as one unit even when it
 * writes across entities.
 *
 * @example
 * ```ts
 * const memory = createMemoryRepositories();
 * const server = createSuitcaseServer(definition, {
 *   repositories: memory,
 *   transaction: memory.transaction,
 * });
 * ```
 */
export interface MemoryRepositories {
  readonly assets: MemoryRepository<Asset>;
  readonly resources: MemoryResourceRepository;
  readonly uploadSessions: MemoryUploadSessionRepository;

  /** Deletes every row, so one backend can be reused across tests. */
  reset(): void;

  /** The transaction runner a service needs: it binds all three repositories to one scope. */
  readonly transaction: SuitcaseTransactionRunner;
}

/** Everything a store held, plus the way to put it back. */
const remember = <TEntity extends { id: string }>(store: MemoryStore<TEntity>) => ({
  take: () => store.all,
  restore: (rows: readonly TEntity[]) => {
    store.clear();
    for (const row of rows) store.set(row);
  },
});

export const createMemoryRepositories = (
  options: MemoryRepositoryOptions = {},
): MemoryRepositories => {
  const { createId } = options;

  const assetStore = new MemoryStore<Asset>();
  const resourceStore = new MemoryStore<Resource>();
  const uploadStore = new MemoryStore<UploadSession>();

  const assets = new MemoryRepository<Asset>(assetStore, createId);
  const resources = new MemoryResourceRepository(resourceStore, assetStore, createId);
  const uploadSessions = new MemoryUploadSessionRepository(uploadStore, createId);

  // Top-level transactions run one at a time. The store has no row locks, so two transactions
  // that interleave would each decide on the other's uncommitted state, and the loser's rollback
  // would restore a snapshot that predates the winner's writes. Serializing them keeps the
  // compare-and-set semantics a real backend gives (a `where status = ...` update).
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const transaction: SuitcaseTransactionRunner = <TCtx extends TransactionalContext, TResult>(
    context: TCtx,
    work: (context: TCtx) => Promise<TResult>,
  ): Promise<TResult> => {
    const assetsMemory = remember(assetStore);
    const resourcesMemory = remember(resourceStore);
    const uploadsMemory = remember(uploadStore);

    // Each repository is rebound to the store it owns: a repository does not follow a context, so
    // the runner is what keeps every write inside the same unit of work.
    const bound = {
      ...context,
      isInTransaction: true,
      assetRepo: assets.withContext({
        store: assetStore,
        [TRANSACTION_EXECUTOR]: assetStore,
        isInTransaction: true,
      }),
      resourceRepo: resources.withContext({
        store: resourceStore,
        [TRANSACTION_EXECUTOR]: resourceStore,
        isInTransaction: true,
      }),
      uploadSessionRepo: uploadSessions.withContext({
        store: uploadStore,
        [TRANSACTION_EXECUTOR]: uploadStore,
        isInTransaction: true,
      }),
    } as typeof context;

    const run = () => {
      // The snapshot is taken once this transaction is the one in play, so a rollback restores
      // what the transaction started from rather than what the store held when it queued.
      const savedAssets = assetsMemory.take();
      const savedResources = resourcesMemory.take();
      const savedUploads = uploadsMemory.take();

      return work(bound).catch((error: unknown) => {
        assetsMemory.restore(savedAssets);
        resourcesMemory.restore(savedResources);
        uploadsMemory.restore(savedUploads);
        throw error;
      });
    };

    // A nested call is a savepoint on the transaction already in play, so it must not queue
    // behind the transaction that holds the lock.
    return context.isInTransaction ? run() : serialized(run);
  };

  return {
    assets,
    resources,
    uploadSessions,
    reset: () => {
      assetStore.clear();
      resourceStore.clear();
      uploadStore.clear();
    },
    transaction,
  };
};
