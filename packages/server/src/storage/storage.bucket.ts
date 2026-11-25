import type { BucketAccessPolicy } from "./storage.access-policy.js";
import type {
  CopyObjectInput,
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  GetObjectOptions,
  GetObjectResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedRequest,
  PutObjectInput,
  PutObjectResult,
  StoredObject,
} from "./storage.operations.js";

export interface BucketConfig {
  access: BucketAccessPolicy;
  storage: StorageBucket;
}

/**
 * Who removes an upload's source object once finalize has copied it into its destination.
 *
 * - `DELETE_AFTER_FINALIZE`: the server queues `uploads.purge` after the resource commits.
 * - `BUCKET_LIFECYCLE`: the bucket's own lifecycle rule owns cleanup and no purge is queued.
 */
export type UploadCleanupPolicy = (typeof UploadCleanupPolicy)[keyof typeof UploadCleanupPolicy];

export const UploadCleanupPolicy = Object.freeze({
  DELETE_AFTER_FINALIZE: "deleteAfterFinalize",
  BUCKET_LIFECYCLE: "bucketLifecycle",
});

/** The upload bucket's config, with the cleanup policy defaulting to `DELETE_AFTER_FINALIZE`. */
export interface UploadBucketConfig extends BucketConfig {
  cleanupUploads?: UploadCleanupPolicy;
}

/**
 * The storage bucket represents a logical container for storing assets,
 * such as files or objects, within a storage system.
 *
 * The underlying system here uses S3 terminology, but the interface is designed
 * to be abstract enough to accommodate other storage backends as well.
 *
 * @note Reasoning for the S3-native name is obviously its widespread recognition
 * and familiarity within the context of object storage systems, and also
 * Stratforge's original implementation was based on S3, hence the naming convention.
 *
 * Every operation throws {@link StorageError} when it fails. Absence is reported
 * as `null` only where it is an expected outcome, never as an error.
 *
 * @human
 */
export interface StorageBucket {
  /** [Pure] Name of the bucket as known to the backend. */
  getName(): string;

  /** [Pure] Unsigned URL for a publicly readable object, or `null` when the bucket is private. */
  getPublicUrl(key: string): string | null;

  /**
   * Stores an object, replacing any existing object at the same key.
   *
   * @throws {StorageError} When the object cannot be stored, or when the
   * underlying storage operation fails in general.
   */
  put(input: PutObjectInput): Promise<PutObjectResult>;

  /**
   * Reads an object's metadata and body; `null` when it does not exist.
   *
   * @throws {StorageError} When the object cannot be read, or when the
   * underlying storage operation fails in general.
   */
  get(key: string, options?: GetObjectOptions): Promise<GetObjectResult | null>;

  /**
   * Reads an object's metadata only; `null` when it does not exist.
   *
   * **Important:** The head SHOULD always be returning a checksum.
   *
   * @throws {StorageError} When the metadata cannot be read, or when the
   * underlying storage operation fails in general.
   */
  head(key: string): Promise<StoredObject | null>;

  /**
   * Deletes an object. Idempotent: deleting a missing object succeeds.
   *
   * @throws {StorageError} When the object cannot be deleted, or when the
   * underlying storage operation fails in general.
   */
  remove(key: string): Promise<void>;

  /**
   * Copies an object, to another key and optionally into another bucket.
   *
   * @throws {StorageError} When the source is missing (`not_found`), or when
   * the underlying storage operation fails in general.
   */
  copy(input: CopyObjectInput): Promise<void>;

  /**
   * Lists objects, optionally filtered by prefix; paginate via `nextCursor`.
   *
   * @throws {StorageError} When the objects cannot be listed, or when the
   * underlying storage operation fails in general.
   */
  list(options?: ListObjectsOptions): Promise<ListObjectsResult>;

  /**
   * Time-limited URL for the client to upload directly. {@link getPublicUrl}
   *
   * @throws {StorageError} When the URL cannot be signed, or when the
   * underlying storage operation fails in general.
   */
  createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedRequest>;

  /**
   * Time-limited URL for the client to download directly. {@link getPublicUrl}
   *
   * @throws {StorageError} When the URL cannot be signed, or when the
   * underlying storage operation fails in general.
   */
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedRequest>;
}
