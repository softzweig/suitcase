import type { ServiceResult } from "@softzweig/suitcase-core";
import type {
  AssetRepository,
  ResourceRepository,
  UploadSessionRepository,
} from "../repository.js";
import { BaseTransactional, type TransactionalContext } from "../transactional.js";
import { ServiceResultPromise, toServiceFailure } from "./service.result.js";

export type SuitcaseServiceContext = Readonly<{
  assetRepo: AssetRepository;
  resourceRepo: ResourceRepository;
  uploadSessionRepo: UploadSessionRepository;
}> &
  TransactionalContext;

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
        this.assertTransactional();
        return fn.call(this, ctx);
      }),
    );
  }

  nontransactional<T>(fn: (this: this, context: TCtx) => Promise<T>): ServiceResultPromise<T> {
    return this.execute((ctx) => {
      this.assertNotTransactional();
      return fn.call(this, ctx);
    });
  }
}
