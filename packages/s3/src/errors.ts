import { S3ServiceException } from "@aws-sdk/client-s3";

import { StorageError, StorageErrorCode } from "@softzweig/suitcase-server";

/** S3 signals a missing object with a 404 rather than a dedicated error type. */
export const isNotFound = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 ||
    error.name === "NoSuchKey" ||
    error.name === "NotFound");

const CHECKSUM_ERRORS = new Set(["BadDigest", "XAmzContentChecksumMismatch"]);

/** `NoSuchBucket` also carries a 404, so it has to be classified first. */
const codeFor = (error: S3ServiceException): StorageErrorCode => {
  const status = error.$metadata.httpStatusCode ?? 0;

  if (error.name === "NoSuchBucket") return StorageErrorCode.BUCKET_MISSING;
  if (CHECKSUM_ERRORS.has(error.name)) return StorageErrorCode.CHECKSUM_MISMATCH;
  if (error.name === "AccessDenied" || status === 403) {
    return StorageErrorCode.FORBIDDEN;
  }
  if (error.name === "NoSuchKey" || error.name === "NotFound" || status === 404) {
    return StorageErrorCode.NOT_FOUND;
  }
  if (error.$retryable || status >= 500) return StorageErrorCode.UNAVAILABLE;

  return StorageErrorCode.UNKNOWN;
};

/**
 * Translates an SDK failure into the port's error vocabulary.
 *
 * The original error is always attached as `cause` and already-translated errors
 * are returned untouched, so guards can nest without double wrapping.
 */
export const toStorageError = (error: unknown): StorageError => {
  if (error instanceof StorageError) return error;

  if (!(error instanceof S3ServiceException)) {
    return new StorageError(StorageErrorCode.UNAVAILABLE, "S3 request failed", {
      cause: error,
    });
  }

  return new StorageError(codeFor(error), `S3 ${error.name}`, { cause: error });
};
