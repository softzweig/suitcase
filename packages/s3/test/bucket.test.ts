import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { StorageErrorCode } from "@softzweig/suitcase-server";
import { describe, expect, it, test } from "vitest";

import { S3StorageBucket } from "../src/index.js";
import {
  BUCKET,
  createBucket,
  createClient,
  KEY,
  SHA256_HEX,
  SHA512_HEX,
  s3Error,
  sentInput,
  toBase64,
} from "./support.js";

const SHA256_BASE64 = toBase64(SHA256_HEX);
const SHA512_BASE64 = toBase64(SHA512_HEX);

describe("S3StorageBucket", () => {
  describe("getName", () => {
    it("returns the configured bucket name", () => {
      expect(createBucket().bucket.getName()).toBe(BUCKET);
    });
  });

  describe("getPublicUrl", () => {
    test.for([
      {
        label: "a bucket with a public URL",
        publicUrl: "https://cdn.example.com",
        expected: `https://cdn.example.com/${KEY}`,
      },
      { label: "a bucket without one", publicUrl: undefined, expected: null },
    ] as const)("builds the URL for $label", ({ publicUrl, expected }) => {
      expect(createBucket(undefined, publicUrl).bucket.getPublicUrl(KEY)).toBe(expected);
    });
  });

  describe("put", () => {
    test.for([
      {
        label: "sha256",
        checksum: { hashHex: SHA256_HEX, hashAlgorithm: "sha256" },
        expected: { ChecksumSHA256: SHA256_BASE64 },
      },
      {
        label: "sha512",
        checksum: { hashHex: SHA512_HEX, hashAlgorithm: "sha512" },
        expected: { ChecksumSHA512: SHA512_BASE64 },
      },
    ] as const)("sends the $label checksum parameter", async ({ checksum, expected }) => {
      const { bucket, commands } = createBucket(() => ({ ETag: '"etag"' }));

      await bucket.put({
        key: KEY,
        body: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
        checksum,
      });

      expect(commands[0]).toBeInstanceOf(PutObjectCommand);
      expect(sentInput(commands)).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        ContentType: "image/png",
        ...expected,
      });
    });

    it("omits every checksum parameter when none is supplied", async () => {
      const { bucket, commands } = createBucket();

      await bucket.put({
        key: KEY,
        body: new Uint8Array([1]),
        contentType: "image/png",
      });

      const checksumParameters = Object.keys(sentInput(commands)).filter((name) =>
        name.startsWith("Checksum"),
      );

      expect(checksumParameters).toEqual([]);
    });

    it("forwards metadata and caching, and returns the reported etag", async () => {
      const { bucket, commands } = createBucket(() => ({ ETag: '"etag"' }));

      const result = await bucket.put({
        key: KEY,
        body: new Uint8Array([1]),
        contentType: "image/png",
        cacheControl: "public, max-age=60",
        metadata: { uploader: "u_1" },
      });

      expect(sentInput(commands)).toMatchObject({
        CacheControl: "public, max-age=60",
        Metadata: { uploader: "u_1" },
      });
      expect(result).toEqual({ key: KEY, etag: '"etag"' });
    });

    it("streams an async iterable body", async () => {
      const { bucket, commands } = createBucket();

      await bucket.put({
        key: KEY,
        body: (async function* () {
          yield new Uint8Array([1]);
        })(),
        contentType: "image/png",
      });

      expect(sentInput(commands).Body).toBeInstanceOf(Readable);
    });

    it("raises an unavailable storage error for server faults", async () => {
      const { bucket } = createBucket(() => {
        throw s3Error("InternalError", 500);
      });

      await expect(
        bucket.put({
          key: KEY,
          body: new Uint8Array([1]),
          contentType: "image/png",
        }),
      ).rejects.toMatchObject({ code: StorageErrorCode.UNAVAILABLE });
    });
  });

  describe("get", () => {
    const lastModified = new Date("2026-11-11T10:00:00.000Z");

    it("returns the body alongside the metadata", async () => {
      const body = Readable.from([new Uint8Array([1, 2, 3])]);
      const { bucket, commands } = createBucket(() => ({
        ContentLength: 3,
        Body: body,
        LastModified: lastModified,
      }));

      const result = await bucket.get(KEY);

      expect(commands[0]).toBeInstanceOf(GetObjectCommand);
      expect(result?.body).toBe(body);
      expect(result?.size).toBe(3);
      expect(result?.lastModified).toBe(lastModified);
    });

    test.for([
      {
        label: "a closed range",
        range: { start: 0, end: 2 },
        expected: "bytes=0-2",
      },
      {
        label: "a single byte",
        range: { start: 0, end: 0 },
        expected: "bytes=0-0",
      },
      { label: "an open range", range: { start: 5 }, expected: "bytes=5-" },
      { label: "no range", range: undefined, expected: undefined },
    ])("requests $label", async ({ range, expected }) => {
      const { bucket, commands } = createBucket(() => ({
        Body: Readable.from([]),
      }));

      await bucket.get(KEY, range ? { range } : undefined);

      expect(sentInput(commands)).toMatchObject({
        Bucket: BUCKET,
        Key: KEY,
        ChecksumMode: "ENABLED",
      });
      expect(sentInput(commands).Range).toBe(expected);
    });

    it("returns null for a missing object", async () => {
      const { bucket } = createBucket(() => {
        throw s3Error("NoSuchKey", 404);
      });

      await expect(bucket.get(KEY)).resolves.toBeNull();
    });

    it("reports a missing bucket instead of null", async () => {
      const { bucket } = createBucket(() => {
        throw s3Error("NoSuchBucket", 404);
      });

      await expect(bucket.get(KEY)).rejects.toMatchObject({
        name: "StorageError",
        code: StorageErrorCode.BUCKET_MISSING,
      });
    });

    it("raises a forbidden storage error for other failures", async () => {
      const { bucket } = createBucket(() => {
        throw s3Error("AccessDenied", 403);
      });

      await expect(bucket.get(KEY)).rejects.toMatchObject({
        name: "StorageError",
        code: StorageErrorCode.FORBIDDEN,
      });
    });
  });

  describe("head", () => {
    it("maps the S3 response to a stored object", async () => {
      const lastModified = new Date("2026-11-11T10:00:00.000Z");
      const { bucket, commands } = createBucket(() => ({
        ContentLength: 42,
        ContentType: "image/png",
        ETag: '"etag"',
        LastModified: lastModified,
        Metadata: { uploader: "u_1" },
        ChecksumSHA256: SHA256_BASE64,
      }));

      await expect(bucket.head(KEY)).resolves.toEqual({
        key: KEY,
        size: 42,
        contentType: "image/png",
        etag: '"etag"',
        lastModified,
        metadata: { uploader: "u_1" },
        checksum: { hashHex: SHA256_HEX, hashAlgorithm: "sha256" },
      });
      expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
    });

    test.for([
      { name: "NotFound", statusCode: 404 },
      { name: "NoSuchKey", statusCode: 404 },
    ])("returns null for a $name response", async ({ name, statusCode }) => {
      const { bucket } = createBucket(() => {
        throw s3Error(name, statusCode);
      });

      await expect(bucket.head(KEY)).resolves.toBeNull();
    });

    it("raises a forbidden storage error for other failures", async () => {
      const { bucket } = createBucket(() => {
        throw s3Error("AccessDenied", 403);
      });

      await expect(bucket.head(KEY)).rejects.toMatchObject({
        name: "StorageError",
        code: StorageErrorCode.FORBIDDEN,
      });
    });
  });

  describe("remove", () => {
    it("deletes by key", async () => {
      const { bucket, commands } = createBucket();

      await bucket.remove(KEY);

      expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
      expect(sentInput(commands)).toMatchObject({ Bucket: BUCKET, Key: KEY });
    });
  });

  describe("copy", () => {
    test.for([
      {
        label: "an overridden content type",
        contentType: "image/webp",
        directive: "REPLACE",
      },
      {
        label: "the source metadata",
        contentType: undefined,
        directive: undefined,
      },
    ] as const)("keeps $label", async ({ contentType, directive }) => {
      const { bucket, commands } = createBucket();

      await bucket.copy({
        sourceKey: KEY,
        destinationKey: "assets/b.webp",
        contentType,
      });

      expect(commands[0]).toBeInstanceOf(CopyObjectCommand);
      expect(sentInput(commands)).toMatchObject({
        Bucket: BUCKET,
        Key: "assets/b.webp",
        CopySource: `${BUCKET}/${encodeURIComponent(KEY)}`,
      });
      expect(sentInput(commands).MetadataDirective).toBe(directive);
    });
  });

  describe("list", () => {
    it("maps objects and forwards the pagination options", async () => {
      const lastModified = new Date("2026-11-11T10:00:00.000Z");
      const { bucket, commands } = createBucket(() => ({
        Contents: [{ Key: KEY, Size: 10, ETag: '"etag"', LastModified: lastModified }],
        IsTruncated: true,
        NextContinuationToken: "next-page",
      }));

      const result = await bucket.list({
        prefix: "assets/",
        cursor: "previous-page",
        limit: 5,
      });

      expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
      expect(sentInput(commands)).toMatchObject({
        Bucket: BUCKET,
        Prefix: "assets/",
        ContinuationToken: "previous-page",
        MaxKeys: 5,
      });
      expect(result.objects).toEqual([{ key: KEY, size: 10, etag: '"etag"', lastModified }]);
      expect(result.nextCursor).toBe("next-page");
    });

    test.for([
      { label: "a truncated page", isTruncated: true, expected: "next-page" },
      { label: "the last page", isTruncated: false, expected: undefined },
    ])("reports nextCursor for $label", async ({ isTruncated, expected }) => {
      const { bucket } = createBucket(() => ({
        Contents: [],
        IsTruncated: isTruncated,
        NextContinuationToken: "next-page",
      }));

      const result = await bucket.list();

      expect(result.objects).toEqual([]);
      expect(result.nextCursor).toBe(expected);
    });
  });

  describe("createUploadUrl", () => {
    it("signs a PUT that expires after the requested seconds", async () => {
      const bucket = new S3StorageBucket(createClient(), BUCKET);
      const before = Date.now();

      const presigned = await bucket.createUploadUrl({
        key: KEY,
        expiresInSeconds: 600,
        contentType: "image/png",
        contentLength: 3,
      });

      const after = Date.now();
      const url = new URL(presigned.url);

      expect(presigned.method).toBe("PUT");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
      expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
      expect(presigned.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 600_000);
      expect(presigned.expiresAt.getTime()).toBeLessThanOrEqual(after + 600_000);
    });

    it("signs the checksum header instead of hoisting it into the query", async () => {
      const bucket = new S3StorageBucket(createClient(), BUCKET);

      const presigned = await bucket.createUploadUrl({
        key: KEY,
        expiresInSeconds: 60,
        checksum: { hashHex: SHA256_HEX, hashAlgorithm: "sha256" },
      });

      const url = new URL(presigned.url);

      expect(url.searchParams.get("x-amz-checksum-sha256")).toBeNull();
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
    });
  });

  describe("createDownloadUrl", () => {
    it("signs a GET that expires after the requested seconds", async () => {
      const bucket = new S3StorageBucket(createClient(), BUCKET);
      const before = Date.now();

      const presigned = await bucket.createDownloadUrl({
        key: KEY,
        expiresInSeconds: 300,
        responseContentDisposition: 'attachment; filename="a.png"',
      });

      const after = Date.now();
      const url = new URL(presigned.url);

      expect(presigned.method).toBe("GET");
      expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(url.searchParams.get("response-content-disposition")).toBe(
        'attachment; filename="a.png"',
      );
      expect(presigned.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300_000);
      expect(presigned.expiresAt.getTime()).toBeLessThanOrEqual(after + 300_000);
    });
  });
});
