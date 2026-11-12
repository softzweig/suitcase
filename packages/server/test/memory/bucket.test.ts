import { describe, expect, it, vi } from "vitest";

import {
  createMemoryBucket,
  createMemoryBucketConfig,
  type MemoryBucket,
} from "../../src/memory/index.js";
import { BucketAccessPolicy } from "../../src/storage/storage.access-policy.js";
import { StorageErrorCode } from "../../src/storage/storage.errors.js";
import { readBytes } from "../../src/storage/storage.helpers.js";
import type { GetObjectResult } from "../../src/storage/storage.operations.js";

const bytes = (...values: number[]) => new Uint8Array(values);

const readBody = async (object: GetObjectResult | null) => {
  if (!object) throw new Error("expected an object");

  return readBytes(object.body);
};

describe("MemoryBucket", () => {
  describe("put and head", () => {
    it("reports the metadata it was given, without the body", async () => {
      const bucket = createMemoryBucket("assets");

      await bucket.put({
        key: "assets/cat.png",
        body: bytes(1, 2, 3),
        contentType: "image/png",
        checksum: { hashAlgorithm: "sha256", hashHex: "a".repeat(64) },
        metadata: { uploader: "u_1" },
      });

      const object = await bucket.head("assets/cat.png");

      expect(object).toMatchObject({
        key: "assets/cat.png",
        size: 3,
        contentType: "image/png",
        checksum: { hashAlgorithm: "sha256", hashHex: "a".repeat(64) },
        metadata: { uploader: "u_1" },
      });
      expect(object).not.toHaveProperty("body");
    });

    it("derives the size from the body", async () => {
      const bucket = createMemoryBucket("assets");

      await bucket.put({ key: "a", body: bytes(1, 2, 3, 4), contentType: "image/png" });

      await expect(bucket.head("a")).resolves.toMatchObject({ size: 4 });
    });

    it("reads a streamed body", async () => {
      const bucket = createMemoryBucket("assets");

      await bucket.put({
        key: "a",
        contentType: "image/png",
        body: (async function* () {
          yield bytes(1, 2);
          yield bytes(3);
        })(),
      });

      await expect(bucket.head("a")).resolves.toMatchObject({ size: 3 });
    });

    it("replaces an object stored under the same key", async () => {
      const bucket = createMemoryBucket("assets");

      await bucket.put({ key: "a", body: bytes(1), contentType: "image/png" });
      await bucket.put({ key: "a", body: bytes(1, 2), contentType: "image/jpeg" });

      await expect(bucket.head("a")).resolves.toMatchObject({ size: 2, contentType: "image/jpeg" });
    });

    it("returns null for an object that is not there", async () => {
      const bucket = createMemoryBucket("assets");

      await expect(bucket.head("missing")).resolves.toBeNull();
    });
  });

  describe("get", () => {
    it("streams the stored bytes", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.put({ key: "a", body: bytes(1, 2, 3), contentType: "image/png" });

      const object = await bucket.get("a");

      await expect(readBody(object)).resolves.toEqual(bytes(1, 2, 3));
    });

    it("returns null for an object that is not there", async () => {
      const bucket = createMemoryBucket("assets");

      await expect(bucket.get("missing")).resolves.toBeNull();
    });

    it("honours a byte range", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.put({ key: "a", body: bytes(1, 2, 3, 4), contentType: "image/png" });

      const object = await bucket.get("a", { range: { start: 1, end: 2 } });

      await expect(readBody(object)).resolves.toEqual(bytes(2, 3));
      expect(object).toMatchObject({ size: 2 });
    });
  });

  describe("remove and copy", () => {
    it("removes an object", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.put({ key: "a", body: bytes(1), contentType: "image/png" });

      await bucket.remove("a");

      await expect(bucket.head("a")).resolves.toBeNull();
    });

    it("removes a missing object without failing", async () => {
      const bucket = createMemoryBucket("assets");

      await expect(bucket.remove("missing")).resolves.toBeUndefined();
    });

    it("copies within the bucket and keeps the source", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.put({ key: "a", body: bytes(1, 2), contentType: "image/png" });

      await bucket.copy({ sourceKey: "a", destinationKey: "b", contentType: "image/jpeg" });

      await expect(bucket.head("b")).resolves.toMatchObject({ size: 2, contentType: "image/jpeg" });
      await expect(bucket.head("a")).resolves.toMatchObject({ contentType: "image/png" });
    });

    it("reports a missing copy source as not found", async () => {
      const bucket = createMemoryBucket("assets");

      await expect(
        bucket.copy({ sourceKey: "missing", destinationKey: "b" }),
      ).rejects.toMatchObject({ code: StorageErrorCode.NOT_FOUND });
    });
  });

  describe("list", () => {
    const givenObjects = async (bucket: MemoryBucket, keys: string[]) => {
      for (const key of keys) await bucket.put({ key, body: bytes(1), contentType: "text/plain" });
    };

    it("filters by prefix and sorts by key", async () => {
      const bucket = createMemoryBucket("assets");
      await givenObjects(bucket, ["b/2", "a/1", "b/1"]);

      const page = await bucket.list({ prefix: "b/" });

      expect(page.objects.map((object) => object.key)).toEqual(["b/1", "b/2"]);
      expect(page.nextCursor).toBeUndefined();
    });

    it("continues from the cursor it handed out", async () => {
      const bucket = createMemoryBucket("assets");
      await givenObjects(bucket, ["a", "b", "c"]);

      const first = await bucket.list({ limit: 2 });
      const second = await bucket.list({ limit: 2, cursor: first.nextCursor });

      expect(first.objects.map((object) => object.key)).toEqual(["a", "b"]);
      expect(second.objects.map((object) => object.key)).toEqual(["c"]);
      expect(second.nextCursor).toBeUndefined();
    });
  });

  describe("urls", () => {
    it("hides the public url of a private bucket", () => {
      const bucket = createMemoryBucket("assets");

      expect(bucket.getPublicUrl("a")).toBeNull();
    });

    it("exposes the public url of a public bucket", () => {
      const bucket = createMemoryBucket("assets", { access: BucketAccessPolicy.PUBLIC });

      expect(bucket.getPublicUrl("a")).toBe("memory://assets/a");
    });

    it.for([{ method: "PUT" as const }, { method: "GET" as const }])(
      "issues a $method request that expires when it says",
      async ({ method }) => {
        const bucket = createMemoryBucket("assets");

        const request =
          method === "PUT"
            ? await bucket.createUploadUrl({ key: "a", expiresInSeconds: 60 })
            : await bucket.createDownloadUrl({ key: "a", expiresInSeconds: 60 });

        expect(request.url).toBe("memory://assets/a");
        expect(request.method).toBe(method);
        expect(Date.parse(request.expiresAt)).toBeGreaterThan(Date.now());
      },
    );
  });

  describe("presigned uploads", () => {
    it("stores what the client uploaded, with the content type the url pinned", async () => {
      const bucket = createMemoryBucket("assets");
      const request = await bucket.createUploadUrl({
        key: "assets/cat.png",
        expiresInSeconds: 60,
        contentType: "image/png",
      });

      await bucket.putPresigned(request, bytes(1, 2, 3));

      await expect(bucket.head("assets/cat.png")).resolves.toMatchObject({
        size: 3,
        contentType: "image/png",
      });
    });

    it("refuses a url it never issued", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.createUploadUrl({ key: "a", expiresInSeconds: 60 });

      await expect(
        bucket.putPresigned({ url: "memory://assets/b", method: "PUT", expiresAt: "" }, bytes(1)),
      ).rejects.toMatchObject({
        code: StorageErrorCode.FORBIDDEN,
        message: "No PUT URL was issued for memory://assets/b",
      });
      await expect(bucket.head("b")).resolves.toBeNull();
    });

    it("refuses an expired url", async () => {
      vi.useFakeTimers();

      try {
        const bucket = createMemoryBucket("assets");
        const request = await bucket.createUploadUrl({ key: "a", expiresInSeconds: 60 });

        vi.advanceTimersByTime(61_000);

        await expect(bucket.putPresigned(request, bytes(1))).rejects.toMatchObject({
          code: StorageErrorCode.FORBIDDEN,
          message: "Presigned request has expired",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses a download url used to upload", async () => {
      const bucket = createMemoryBucket("assets");
      const request = await bucket.createDownloadUrl({ key: "a", expiresInSeconds: 60 });

      await expect(
        bucket.putPresigned({ ...request, method: "PUT" }, bytes(1)),
      ).rejects.toMatchObject({ code: StorageErrorCode.FORBIDDEN });
    });
  });

  describe("presigned downloads", () => {
    it("serves the object the url names", async () => {
      const bucket = createMemoryBucket("assets");
      await bucket.put({ key: "a", body: bytes(4, 5), contentType: "text/plain" });
      const request = await bucket.createDownloadUrl({ key: "a", expiresInSeconds: 60 });

      await expect(readBody(await bucket.getPresigned(request))).resolves.toEqual(bytes(4, 5));
    });

    it("returns null for an object that is not there", async () => {
      const bucket = createMemoryBucket("assets");
      const request = await bucket.createDownloadUrl({ key: "missing", expiresInSeconds: 60 });

      await expect(bucket.getPresigned(request)).resolves.toBeNull();
    });
  });

  it("builds a bucket config whose access and bucket agree", () => {
    const privateConfig = createMemoryBucketConfig("assets");
    const publicConfig = createMemoryBucketConfig("public", {
      access: BucketAccessPolicy.PUBLIC,
    });

    expect(privateConfig.access).toBe(BucketAccessPolicy.PRIVATE);
    expect(privateConfig.storage.getPublicUrl("a")).toBeNull();
    expect(publicConfig.access).toBe(BucketAccessPolicy.PUBLIC);
    expect(publicConfig.storage.getName()).toBe("public");
    expect(publicConfig.storage.getPublicUrl("a")).toBe("memory://public/a");
  });
});
