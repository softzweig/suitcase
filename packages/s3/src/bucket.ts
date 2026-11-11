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
} from "@softzweig/suitcase-server";

import { isNotFound, toStorageError } from "./errors.js";
import { CHECKSUM_HEADERS, checksumParams, expiresAt, toRange, toStoredObject } from "./mapping.js";

/**
 * S3 implementation of the {@link StorageBucket} port.
 *
 * The bucket name is fixed per instance, so operations only take object keys.
 */
export class S3StorageBucket implements StorageBucket {
  constructor(
    readonly s3: S3Client,
    readonly name: string,
    readonly publicUrl?: string,
  ) {}

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
    return this.publicUrl ? `${this.publicUrl}/${key}` : null;
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
    await this.send(() =>
      this.s3.send(
        new CopyObjectCommand({
          Bucket: this.name,
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
    const signingDate = new Date();
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
          signableHeaders: new Set(["content-type", "content-length"]),
          unhoistableHeaders: new Set(CHECKSUM_HEADERS),
        },
      ),
    );

    return {
      url,
      method: "PUT",
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
