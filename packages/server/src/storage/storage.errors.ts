export type StorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];

/**
 * Raised by every bucket operation that fails.
 *
 * The `cause` chain keeps the backend detail (request ids, retry hints) reachable
 * for logging, while consumers branch on {@link StorageErrorCode}.
 */
export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

/**
 * Failure categories a storage backend can report.
 *
 * Adapters translate their own error shapes into these codes, so consumers never
 * depend on a specific storage library.
 */
export const StorageErrorCode = Object.freeze({
  /** The object is absent where the operation requires it, e.g. a copy source. */
  NOT_FOUND: "not_found",
  /** Credentials or bucket policy denied the operation. */
  FORBIDDEN: "forbidden",
  /** The payload did not match the checksum the caller declared. */
  CHECKSUM_MISMATCH: "checksum_mismatch",
  /** The configured bucket does not exist — a deployment fault, not a user error. */
  BUCKET_MISSING: "bucket_missing",
  /** Transport failure, throttling or a server-side fault; safe to retry. */
  UNAVAILABLE: "unavailable",
  /** A failure the adapter could not classify. */
  UNKNOWN: "unknown",
});
