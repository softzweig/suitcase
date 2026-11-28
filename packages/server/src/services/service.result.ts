import type { SpindleErrorCode, SpindleFailure } from "@softzweig/spindle-core/result";
import { toServiceFailure as toSpindleFailure } from "@softzweig/spindle-core/service";
import { StorageError, type StorageErrorCode } from "../storage/storage.errors.js";

/**
 * How a storage failure reads to a caller.
 *
 * Exhaustive on purpose: a new {@link StorageErrorCode} is a compile error until
 * it is given a service-level meaning.
 */
const CODE_BY_STORAGE = Object.freeze<Record<StorageErrorCode, SpindleErrorCode>>({
  not_found: "not_found",
  forbidden: "forbidden",
  checksum_mismatch: "conflict",
  bucket_missing: "unavailable",
  unavailable: "unavailable",
  unknown: "unknown",
});

/**
 * Folds a thrown error into a failure, so a service call has one failure channel
 * instead of two.
 *
 * Storage failures are translated into the service vocabulary first; everything else is
 * handed to Spindle's own converter, which understands every error carrying a
 * {@link SpindleErrorCode}. The message of an unexpected error is not forwarded, because it
 * tends to carry infrastructure detail — log the error in the transport instead.
 *
 * The server puts this in its context, so it is the converter a service execution uses.
 */
export function toServiceFailure(error: unknown): SpindleFailure {
  if (error instanceof StorageError) {
    return {
      ok: false,
      code: CODE_BY_STORAGE[error.code],
      message: error.message,
      details: {
        type: "storageError",
        code: error.code,
      } as const,
    };
  }

  return toSpindleFailure(error);
}
