import type { ServiceResult } from "@softzweig/suitcase-core";
import type {
  AssetRepository,
  ResourceRepository,
  UploadSessionRepository,
} from "../repository.js";
import type { Definition } from "../suitcase.js";
import {
  BaseTransactional,
  FOLLOWS_CONTEXT,
  type Transactional,
  type TransactionalContext,
} from "../transactional.js";
import { ServiceResultPromise, toServiceFailure } from "./service.result.js";

/**
 * A function the consumer keeps in the context, such as a resolve limit or a download
 * expiry policy. Like plain data it is carried into a transaction untouched.
 */
export type ServiceContextFunction = (...args: never[]) => unknown;

/**
 * What a service context may hold: services and the repositories the transaction
 * runner swaps, both of which are {@link Transactional}, the definition, plain data,
 * and the policy functions the consumer supplies.
 *
 * The list is a guard rather than a dispatch. A value that is none of these would
 * be carried into a transaction untouched, which is the bug this prevents.
 */
export type ServiceContextValue =
  | Transactional<TransactionalContext>
  | ServiceContextFunction
  | Definition
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export type SuitcaseServiceContext<TDefinition extends Definition = Definition> = Readonly<
  Record<string, ServiceContextValue>
> &
  TransactionalContext & {
    assetRepo: AssetRepository;
    resourceRepo: ResourceRepository;
    uploadSessionRepo: UploadSessionRepository;
    definition: TDefinition;
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
