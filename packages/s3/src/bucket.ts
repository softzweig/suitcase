import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  StorageBucket,
  StoredObject,
} from "@softzweig/suitcase-server/storage";

import { assertPresignableClient } from "./client.js";
import { isNotFound, toStorageError } from "./errors.js";
import { checksumParams, expiresAt, toRange, toStoredObject, uploadSignature } from "./mapping.js";

interface BucketOptions {
  readonly s3: S3Client;
  readonly name: string;
  /** Base URL of the bucket. Trailing slashes are ignored. */
  readonly publicUrl?: string | null;
}

/**
 * S3 implementation of the {@link StorageBucket} port.
 *
 * The bucket name is fixed per instance, so operations only take object keys.
 *
 * The client must be created with `requestChecksumCalculation: "WHEN_REQUIRED"`
 * (see {@link createS3Client}). The SDK default attaches a CRC32 of an empty body
 * to presigned uploads, leaving URLs that no client can satisfy. Prefer
 * {@link create}, which checks this up front; the constructor only defers the
 * check to the first {@link createUploadUrl}.
 */
export class S3StorageBucket implements StorageBucket {
  readonly s3: S3Client;
  readonly name: string;
  readonly publicUrl?: string | null;

  /** @deprecated Prefer {@link create} instead of the constructor. Only for inheritance or tests. */
  constructor({ s3, name, publicUrl }: BucketOptions) {
    this.s3 = s3;
    this.name = name;
    this.publicUrl = publicUrl;
  }

  /**
   * Builds a bucket after verifying the client can produce usable presigned URLs.
   *
   * The check is asynchronous, so it cannot live in the constructor; construct
   * directly only when presigning is not used.
   *
   * @throws {StorageError} When the client is not configured with `createS3Client`.
   */
  static async create(options: BucketOptions): Promise<S3StorageBucket> {
    await assertPresignableClient(options.s3);

    return new S3StorageBucket(options);
  }

  /** Runs an SDK call, translating any failure into a `StorageError`. */
  private async send<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toStorageError(error);
    }
  }

  getName(): string {
    return this.name;
  }

  getPublicUrl(key: string): string | null {
    if (!this.publicUrl) return null;
    const base = this.publicUrl.replace(/\/+$/, ""); // <- removes trailing slashes
    const path = key.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
    return `${base}/${path}`;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const body = input.body instanceof Uint8Array ? input.body : Readable.from(input.body);

    const response = await this.send(() =>
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.name,
          Key: input.key,
          Body: body,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
          Metadata: input.metadata ? { ...input.metadata } : undefined,
          ...(input.checksum ? checksumParams(input.checksum) : {}),
        }),
      ),
    );

    return { key: input.key, etag: response.ETag };
  }

  async get(key: string, options?: GetObjectOptions): Promise<GetObjectResult | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.name,
          Key: key,
          Range: toRange(options?.range),
          ChecksumMode: "ENABLED",
        }),
      );

      return {
        ...toStoredObject(key, response),
        body: response.Body as AsyncIterable<Uint8Array>,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw toStorageError(error);
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.name,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
      );

      return toStoredObject(key, response);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw toStorageError(error);
    }
  }

  async remove(key: string): Promise<void> {
    await this.send(() => this.s3.send(new DeleteObjectCommand({ Bucket: this.name, Key: key })));
  }

  async copy(input: CopyObjectInput): Promise<void> {
    // S3 copies server-side from a source path, so the destination needs only its
    // name; the destination is expected to live on this client's endpoint.
    const destination = input.destinationBucket?.getName() ?? this.name;

    await this.send(() =>
      this.s3.send(
        new CopyObjectCommand({
          Bucket: destination,
          Key: input.destinationKey,
          CopySource: `${this.name}/${encodeURIComponent(input.sourceKey)}`,
          ContentType: input.contentType,
          // Without REPLACE, S3 keeps the source metadata and ignores overrides.
          MetadataDirective: input.contentType ? "REPLACE" : undefined,
        }),
      ),
    );
  }

  async list(options?: ListObjectsOptions): Promise<ListObjectsResult> {
    const response = await this.send(() =>
      this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.name,
          Prefix: options?.prefix,
          ContinuationToken: options?.cursor,
          MaxKeys: options?.limit,
        }),
      ),
    );

    return {
      objects: (response.Contents ?? []).map((object) => toStoredObject(object.Key ?? "", object)),
      nextCursor: response.IsTruncated ? response.NextContinuationToken : undefined,
    };
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedRequest> {
    await assertPresignableClient(this.s3);

    const signingDate = new Date();
    const { headers, unhoistable } = uploadSignature(input);
    const url = await this.send(() =>
      getSignedUrl(
        this.s3,
        new PutObjectCommand({
          Bucket: this.name,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
          ...(input.checksum ? checksumParams(input.checksum) : {}),
        }),
        {
          expiresIn: input.expiresInSeconds,
          signingDate,
          signableHeaders: new Set(Object.keys(headers)),
          unhoistableHeaders: new Set(unhoistable),
        },
      ),
    );

    return {
      url,
      method: "PUT",
      headers,
      expiresAt: expiresAt(signingDate, input.expiresInSeconds),
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedRequest> {
    const signingDate = new Date();
    const url = await this.send(() =>
      getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.name,
          Key: input.key,
          ResponseContentDisposition: input.responseContentDisposition,
        }),
        { expiresIn: input.expiresInSeconds, signingDate },
      ),
    );

    return {
      url,
      method: "GET",
      expiresAt: expiresAt(signingDate, input.expiresInSeconds),
    };
  }
}
