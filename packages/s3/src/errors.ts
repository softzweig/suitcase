import { S3ServiceException } from "@aws-sdk/client-s3";
import { StorageError, StorageErrorCode } from "@softzweig/suitcase-server/storage";

const MISSING_NAMES = Object.freeze(["NoSuchKey", "NotFound"]);

const CHECKSUM_NAMES = Object.freeze(["BadDigest", "XAmzContentChecksumMismatch"]);

/**
 * Classifies an SDK failure into the port's error vocabulary.
 *
 * Names are resolved before statuses because S3 reports both a missing bucket
 * and a missing object as 404, so the status alone cannot tell them apart.
 */
function classify(error: S3ServiceException): StorageErrorCode {
  const { name, $metadata, $retryable } = error;
  const status = $metadata.httpStatusCode ?? 0;

  if (name === "NoSuchBucket") {
    return StorageErrorCode.BUCKET_MISSING;
  }
  if (CHECKSUM_NAMES.includes(name)) {
    return StorageErrorCode.CHECKSUM_MISMATCH;
  }
  if (name === "AccessDenied" || status === 403) {
    return StorageErrorCode.FORBIDDEN;
  }
  if (MISSING_NAMES.includes(name) || status === 404) {
    return StorageErrorCode.NOT_FOUND;
  }
  if ($retryable || status >= 500) {
    return StorageErrorCode.UNAVAILABLE;
  }
  return StorageErrorCode.UNKNOWN;
}

/** `true` when S3 reported the object as absent, as opposed to a real failure. */
export const isNotFound = (error: unknown): boolean =>
  error instanceof S3ServiceException && classify(error) === StorageErrorCode.NOT_FOUND;

/**
 * Translates an SDK failure into the port's error vocabulary.
 *
 * The original error is always attached as `cause` and already-translated errors
 * are returned untouched, so guards can nest without double wrapping.
 */
export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) {
    return error;
  }

  if (!(error instanceof S3ServiceException)) {
    return new StorageError(StorageErrorCode.UNAVAILABLE, "S3 request failed", {
      cause: error,
    });
  }

  return new StorageError(classify(error), `S3 ${error.name}`, {
    cause: error,
  });
}
