import { StorageErrorCode } from "@softzweig/suitcase-server/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bytesOf, sha256, uniqueKey, uniquePrefix } from "./support/fixtures.js";
import { STARTUP_TIMEOUT_MS, startStorageServer, type TestStorage } from "./support/server.js";

const BODY = new TextEncoder().encode("hello suitcase");
const TEXT: Readonly<Record<string, string>> = { owner: "asset-1" };

let storage: TestStorage;

// The backend verifies SigV4 signatures and object checksums, so signing and
// checksum enforcement are validated by a real server rather than a mock.
// Needs Docker; `pnpm test:unit` skips this file.
describe("S3StorageBucket against a real S3 API", () => {
  beforeAll(async () => {
    storage = await startStorageServer();
  }, STARTUP_TIMEOUT_MS);

  afterAll(() => storage.stop());

  beforeEach(() => storage.empty());

  const read = async (key: string, options?: Parameters<typeof storage.bucket.get>[1]) => {
    const object = await storage.bucket.get(key, options);
    if (!object) throw new Error(`expected ${key} to exist`);

    return object;
  };

  describe("objects", () => {
    it("round-trips bytes, content type and metadata", async () => {
      const key = uniqueKey();

      await storage.bucket.put({ key, body: BODY, contentType: "text/plain", metadata: TEXT });

      const stored = await read(key);
      expect(stored).toMatchObject({
        key,
        size: BODY.length,
        contentType: "text/plain",
        metadata: TEXT,
      });
      expect(await bytesOf(stored.body)).toEqual(Buffer.from(BODY));
    });

    // Known gap: `PutObjectInput.body` accepts a stream, but a stream of unknown
    // length is sent chunked with no Content-Length, which a strict S3 server
    // rejects with 411. Switch to `@aws-sdk/lib-storage` (or buffer) to fix.
    it.fails("stores a streamed body of unknown length", async () => {
      const key = uniqueKey();
      async function* chunks() {
        yield BODY.subarray(0, 5);
        yield BODY.subarray(5);
      }

      await storage.bucket.put({ key, body: chunks(), contentType: "text/plain" });

      expect(await bytesOf((await read(key)).body)).toEqual(Buffer.from(BODY));
    });

    it("reports headers and null for a missing key", async () => {
      const key = uniqueKey();

      await storage.bucket.put({ key, body: BODY, contentType: "text/plain" });

      await expect(storage.bucket.head(key)).resolves.toMatchObject({
        key,
        size: BODY.length,
        contentType: "text/plain",
      });
      await expect(storage.bucket.head(uniqueKey())).resolves.toBeNull();
      await expect(storage.bucket.get(uniqueKey())).resolves.toBeNull();
    });

    it("replaces an existing object at the same key", async () => {
      const key = uniqueKey();
      const replacement = new TextEncoder().encode("short");

      await storage.bucket.put({ key, body: BODY, contentType: "text/plain" });
      await storage.bucket.put({ key, body: replacement, contentType: "text/markdown" });

      await expect(storage.bucket.head(key)).resolves.toMatchObject({
        size: replacement.length,
        contentType: "text/markdown",
      });
    });

    it("reads a byte range", async () => {
      const key = uniqueKey();

      await storage.bucket.put({ key, body: BODY, contentType: "text/plain" });

      const partial = await read(key, { range: { start: 0, end: 4 } });
      expect(await bytesOf(partial.body)).toEqual(Buffer.from(BODY.subarray(0, 5)));
    });

    it("deletes idempotently", async () => {
      const key = uniqueKey();
      await storage.bucket.put({ key, body: BODY, contentType: "text/plain" });

      await storage.bucket.remove(key);
      await expect(storage.bucket.head(key)).resolves.toBeNull();
      await expect(storage.bucket.remove(key)).resolves.toBeUndefined();
    });

    it("stores and reports the checksum it was given", async () => {
      const key = uniqueKey();
      const checksum = sha256(BODY);

      await storage.bucket.put({ key, body: BODY, contentType: "text/plain", checksum });

      await expect(storage.bucket.head(key)).resolves.toMatchObject({ checksum });
    });
  });

  describe("copy", () => {
    it("copies an object and replaces its content type", async () => {
      const sourceKey = uniqueKey("source.png");
      const destinationKey = uniqueKey("copy.webp");
      await storage.bucket.put({ key: sourceKey, body: BODY, contentType: "image/png" });

      await storage.bucket.copy({ sourceKey, destinationKey, contentType: "image/webp" });

      const copied = await read(destinationKey);
      expect(copied.contentType).toBe("image/webp");
      expect(await bytesOf(copied.body)).toEqual(Buffer.from(BODY));
    });

    it("copies keys that need escaping", async () => {
      const sourceKey = uniqueKey("a folder/übung 1.png");
      const destinationKey = uniqueKey("copy/übung 2.png");
      await storage.bucket.put({ key: sourceKey, body: BODY, contentType: "image/png" });

      await storage.bucket.copy({ sourceKey, destinationKey });

      expect(await bytesOf((await read(destinationKey)).body)).toEqual(Buffer.from(BODY));
    });

    it("rejects a missing source", async () => {
      await expect(
        storage.bucket.copy({ sourceKey: uniqueKey(), destinationKey: uniqueKey() }),
      ).rejects.toMatchObject({ code: StorageErrorCode.NOT_FOUND });
    });
  });

  describe("list", () => {
    it("filters by prefix and paginates with a cursor", async () => {
      const prefix = uniquePrefix();
      await Promise.all(
        ["a.png", "b.png", "c.png"].map((name) =>
          storage.bucket.put({ key: `${prefix}${name}`, body: BODY, contentType: "image/png" }),
        ),
      );
      await storage.bucket.put({ key: uniqueKey(), body: BODY, contentType: "image/png" });

      const first = await storage.bucket.list({ prefix, limit: 2 });
      expect(first.objects.map(({ key }) => key)).toEqual([`${prefix}a.png`, `${prefix}b.png`]);
      expect(first.nextCursor).toBeDefined();

      const second = await storage.bucket.list({ prefix, limit: 2, cursor: first.nextCursor });
      expect(second.objects.map(({ key }) => key)).toEqual([`${prefix}c.png`]);
      expect(second.nextCursor).toBeUndefined();
    });

    it("returns no objects for an unknown prefix", async () => {
      await expect(storage.bucket.list({ prefix: uniquePrefix() })).resolves.toEqual({
        objects: [],
        nextCursor: undefined,
      });
    });
  });

  describe("presigned requests", () => {
    it("accepts an upload through the presigned URL", async () => {
      const key = uniqueKey();
      const presigned = await storage.bucket.createUploadUrl({
        key,
        expiresInSeconds: 60,
        contentType: "text/plain",
        checksum: sha256(BODY),
      });

      const response = await fetch(presigned.url, {
        method: presigned.method,
        headers: presigned.headers,
        body: BODY,
      });

      expect(response.status).toBe(200);
      const stored = await read(key);
      expect(stored.contentType).toBe("text/plain");
      expect(await bytesOf(stored.body)).toEqual(Buffer.from(BODY));
    });

    it("rejects an upload whose body does not match the signed checksum", async () => {
      const key = uniqueKey();
      const presigned = await storage.bucket.createUploadUrl({
        key,
        expiresInSeconds: 60,
        contentType: "text/plain",
        checksum: sha256(BODY),
      });

      const response = await fetch(presigned.url, {
        method: presigned.method,
        headers: presigned.headers,
        body: new TextEncoder().encode("tampered"),
      });

      expect(response.ok).toBe(false);
      await expect(storage.bucket.head(key)).resolves.toBeNull();
    });

    it("allows an upload without a signed checksum", async () => {
      const key = uniqueKey();
      const presigned = await storage.bucket.createUploadUrl({ key, expiresInSeconds: 60 });

      const response = await fetch(presigned.url, { method: presigned.method, body: BODY });

      expect(response.status).toBe(200);
      await expect(storage.bucket.head(key)).resolves.toMatchObject({ size: BODY.length });
    });

    it("rejects a URL whose signature no longer matches", async () => {
      const key = uniqueKey();
      const presigned = await storage.bucket.createUploadUrl({ key, expiresInSeconds: 60 });
      const tampered = new URL(presigned.url);
      // Any change to the signed query invalidates the signature.
      tampered.searchParams.set("X-Amz-Expires", "600");

      const response = await fetch(tampered, { method: presigned.method, body: BODY });

      expect(response.ok).toBe(false);
      await expect(storage.bucket.head(key)).resolves.toBeNull();
    });

    it("serves an object through the presigned URL", async () => {
      const key = uniqueKey();
      const disposition = 'attachment; filename="a.png"';
      await storage.bucket.put({ key, body: BODY, contentType: "text/plain" });

      const presigned = await storage.bucket.createDownloadUrl({
        key,
        expiresInSeconds: 60,
        responseContentDisposition: disposition,
      });

      const response = await fetch(presigned.url);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toBe(disposition);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(BODY));
    });
  });
});
