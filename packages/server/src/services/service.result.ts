import {
  ServiceErrorCode,
  type ServiceFailure,
  type ServiceResult,
} from "@softzweig/suitcase-core";
import { StorageError, type StorageErrorCode } from "../storage/storage.errors.js";
import { ServiceError } from "./service.error.js";

/**
 * An in-flight service call.
 *
 * Await it for the {@link ServiceResult}, or `unwrap()` it to branch with an
 * exception instead, the call site picks which style it needs.
 *
 * @human
 */
export class ServiceResultPromise<T> implements PromiseLike<ServiceResult<T>> {
  constructor(private readonly result: Promise<ServiceResult<T>>) {}

  // biome-ignore lint/suspicious/noThenProperty: intentionally thenable, so `await` yields the result
  then<TResult1 = ServiceResult<T>, TResult2 = never>(
    onfulfilled?: ((value: ServiceResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.result.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<ServiceResult<T> | TResult> {
    return this.result.catch(onrejected);
  }

  /** Returns the data, or throws the {@link ServiceError} the failure represents. */
  async unwrap(): Promise<T> {
    const result = await this.result;

    if (result.ok) return result.data;

    throw new ServiceError(result.code, result.message, result.details);
  }
}

/**
 * How a storage failure reads to a caller.
 *
 * Exhaustive on purpose: a new {@link StorageErrorCode} is a compile error until
 * it is given a service-level meaning.
 */
const CODE_BY_STORAGE = Object.freeze<Record<StorageErrorCode, ServiceErrorCode>>({
  not_found: ServiceErrorCode.NOT_FOUND,
  forbidden: ServiceErrorCode.FORBIDDEN,
  checksum_mismatch: ServiceErrorCode.CONFLICT,
  bucket_missing: ServiceErrorCode.UNAVAILABLE,
  unavailable: ServiceErrorCode.UNAVAILABLE,
  unknown: ServiceErrorCode.UNKNOWN,
});

/**
 * Folds a thrown error into a failure, so a service call has one failure channel
 * instead of two.
 *
 * Sample on purpose: domain errors of your own (a typed `NotFoundError`, say)
 * belong here too. The service-level code is the coarse, stable part; `details`
 * carries the backend code for consumers that need finer discrimination. The
 * message of an unexpected error is not forwarded, because it tends to carry
 * infrastructure detail — log the error in the transport instead.
 */
export function toServiceFailure(error: unknown) {
  if (error instanceof StorageError) {
    return {
      ok: false,
      code: CODE_BY_STORAGE[error.code],
      message: error.message,
      details: {
        type: "storageError",
        code: error.code,
      } as const,
    } satisfies ServiceFailure;
  }

  if (error instanceof ServiceError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      details: error.details,
    } satisfies ServiceFailure;
  }

  return {
    ok: false,
    code: ServiceErrorCode.UNKNOWN,
    message: "Unexpected failure",
  } satisfies ServiceFailure;
}
