import {
  type BucketConfig,
  type UploadBucketConfig,
  UploadCleanupPolicy,
} from "./storage.bucket.js";

export const UPLOAD_BUCKET_KEY = "upload" as const;

/** The cleanup policy an upload bucket uses when it does not declare one. */
export const DEFAULT_UPLOAD_CLEANUP_POLICY = UploadCleanupPolicy.DELETE_AFTER_FINALIZE;

/**
 * The buckets a definition declares, keyed by the name resources are stored under.
 *
 * An entry is a promise while the bucket is still being set up, so readers await it.
 * Every definition has an upload bucket: uploads land there until they are promoted.
 */
export type SuitcaseBuckets = Readonly<Record<string, BucketConfig | Promise<BucketConfig>>> & {
  readonly [UPLOAD_BUCKET_KEY]: UploadBucketConfig;
};
