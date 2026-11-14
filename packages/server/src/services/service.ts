import type { ServiceResult } from "@softzweig/suitcase-core";
import type {
  AssetRepository,
  ResourceRepository,
  UploadSessionRepository,
} from "../repository.js";
import type { SuitcaseBucketRegistry } from "../storage/storage.buckets.js";
import {
  BaseTransactional,
  FOLLOWS_CONTEXT,
  type Transactional,
  type TransactionalContext,
} from "../transactional.js";
import { ServiceResultPromise, toServiceFailure } from "./service.result.js";

/**
 * What a service context may hold: services and the repositories the transaction
 * runner swaps, both of which are {@link Transactional}, a bucket registry, and
 * plain data.
 *
 * The list is a guard rather than a dispatch. A value that is none of these would
 * be carried into a transaction untouched, which is the bug this prevents.
 */
export type ServiceContextValue =
  | Transactional<TransactionalContext>
  | SuitcaseBucketRegistry
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type SuitcaseServiceContext = Readonly<Record<string, ServiceContextValue>> &
  TransactionalContext & {
    assetRepo: AssetRepository;
    resourceRepo: ResourceRepository;
    uploadSessionRepo: UploadSessionRepository;
  };

/**
 * Base for services: carries the context and hands subclasses a transactional
 * copy of themselves, through {@link BaseTransactional}.
 *
 * A subclass widens the context to depend on other services:
 *
 * @example
 * ```ts
 * type AssetServiceContext = SuitcaseServiceContext & { resourceService: ResourceService };
 *
 * class AssetService extends SuitcaseService<AssetServiceContext> {
 *   async describeAsset(id: string) {
 *     const asset = await this.context.assetRepo.findById(id);
 *     // ...
 *   }
 * }
 * ```
 */
export class SuitcaseService<
  TCtx extends SuitcaseServiceContext = SuitcaseServiceContext,
> extends BaseTransactional<TCtx> {
  /** Marks this service as one its holder rebinds when a transaction starts. */
  readonly [FOLLOWS_CONTEXT] = true;

  /**
   * Runs a use case and folds every failure into a {@link ServiceResult}.
   *
   * The returned object is awaitable for the result itself, or `unwrap()`s to
   * the data and throws the domain error instead.
   */
  execute<T>(fn: (this: this, context: TCtx) => Promise<T>): ServiceResultPromise<T> {
    // The async IIFE turns a synchronous throw inside `fn` into a rejection, so
    // assertions and other guards take the same failure path as async errors.
    const run = (async () => fn.call(this, this.context))();

    return new ServiceResultPromise(
      run.then((data) => ({ ok: true, data }) as const).catch(toServiceFailure),
    );
  }

  transactional<T>(fn: (this: this, context: TCtx) => Promise<T>): ServiceResultPromise<T> {
    return this.execute(() =>
      this.transaction(function (ctx) {
        this.assertTransaction();
        return fn.call(this, ctx);
      }),
    );
  }

  nontransactional<T>(fn: (this: this, context: TCtx) => Promise<T>): ServiceResultPromise<T> {
    return this.execute((ctx) => {
      this.assertNotTransaction();
      return fn.call(this, ctx);
    });
  }
}
