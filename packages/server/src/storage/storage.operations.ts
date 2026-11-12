/**
 * Provider-neutral object storage operations, modelled on the S3 object API
 * without binding to it. Adapters (S3, GCS, Azure Blob, local disk) implement
 * the `StorageBucket` port; consumers only ever see these types.
 *
 * Only transport/auth failures throw. A missing object is `null`, never an error.
 */

import type { AssetHash } from "@softzweig/suitcase-core";
import type { StorageBucket } from "./storage.bucket.js";

/**
 * A stream of bytes readable in any JS runtime. Web `ReadableStream` and Node
 * `Readable` both satisfy it structurally, so no platform-specific types leak
 * into the public contract.
 */
export type ByteStream = AsyncIterable<Uint8Array>;

/** Metadata describing a stored object — the S3 `HeadObject` shape. */
export interface StoredObject {
  readonly key: string;
  /** Size in bytes. */
  readonly size: number;
  readonly contentType?: string;
  /** Backend-provided entity tag, when the storage library exposes one. */
  readonly etag?: string;
  /** Content checksum as reported by the backend, when it exposes one. */
  readonly checksum?: AssetHash;
  /** ISO-8601 UTC timestamp of the last write, when the backend reports one. */
  readonly lastModified?: string;
  /** User-defined string metadata (S3 `x-amz-meta-*`). */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array | ByteStream;
  readonly contentType: string;
  readonly cacheControl?: string;
  /** Expected checksum; adapters enforce it when the backend supports the algorithm. */
  readonly checksum?: AssetHash;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PutObjectResult {
  readonly key: string;
  readonly etag?: string;
}

export interface GetObjectOptions {
  readonly range?: {
    readonly start: number;
    /** Inclusive byte offset; omitted means "through the end". */
    readonly end?: number;
  };
}

export interface GetObjectResult extends StoredObject {
  readonly body: ByteStream;
}

export interface CopyObjectInput {
  readonly sourceKey: string;
  readonly destinationKey: string;
  /**
   * Where the copy lands; defaults to this bucket.
   *
   * A handle rather than a name: an adapter owns one bucket, so it cannot look
   * another one up, and the destination is the only thing that can receive the
   * bytes. Adapters copy server-side when the destination is on their backend and
   * fall back to reading and writing through the port when it is not.
   */
  readonly destinationBucket?: StorageBucket;
  /** Overrides the source content type where the backend allows it. */
  readonly contentType?: string;
}

export interface ListObjectsOptions {
  readonly prefix?: string;
  /** Opaque cursor from a previous `ListObjectsResult.nextCursor`. */
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListObjectsResult {
  readonly objects: readonly StoredObject[];
  /** Present when another page exists; pass back as `cursor`. */
  readonly nextCursor?: string;
}

export interface CreateUploadUrlInput {
  readonly key: string;
  /** Seconds until the URL expires. */
  readonly expiresInSeconds: number;
  readonly contentType?: string;
  /** Exact byte length the client may upload, when the backend can enforce it. */
  readonly contentLength?: number;
  /** Checksum the uploaded object must match, when the backend can enforce it. */
  readonly checksum?: AssetHash;
}

export interface CreateDownloadUrlInput {
  readonly key: string;
  readonly expiresInSeconds: number;
  readonly responseContentDisposition?: string;
}

/** A pre-authorized request the client performs directly against the backend. */
export interface PresignedRequest {
  readonly url: string;
  readonly method: "GET" | "PUT";
  /** Headers the client must send verbatim — they are part of the signature. */
  readonly headers?: Readonly<Record<string, string>>;
  /** ISO-8601 UTC timestamp at which the request stops being valid. */
  readonly expiresAt: string;
}
