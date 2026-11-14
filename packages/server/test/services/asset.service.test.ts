import type { Asset } from "@softzweig/suitcase-core";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { describe, expect, it } from "vitest";
import { createMemoryBucketConfig, MemoryBucket } from "../../src/memory/index.js";
import { AssetService, type AssetServiceContext } from "../../src/services/asset.service.js";
import { BucketAccessPolicy } from "../../src/storage/storage.access-policy.js";
import { StorageError, StorageErrorCode } from "../../src/storage/storage.errors.js";
import type { PutObjectInput } from "../../src/storage/storage.operations.js";
import type { Definition } from "../../src/suitcase.js";
import { createMemoryRepositories } from "../support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";
const UPLOAD_KEY = "uploads/pending.png";
const DESTINATION_KEY = "assets/cat.png";

/** The claims a client makes when it opens an upload session. */
const claims = {
  hashAlgorithm: "sha256",
  hashHex: "a".repeat(64),
  size: 3,
  mimeType: "image/png",
} as const;

const createBuckets = () => ({
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
});

/** A bucket whose removals always fail, so the ordering of a delete is observable. */
class UnavailableBucket extends MemoryBucket {
  override async remove(): Promise<void> {
    throw new StorageError(StorageErrorCode.UNAVAILABLE, "backend unavailable");
  }
}

/** A service on a fresh in-memory backend, plus the buckets and rows it acts on. */
const givenService = (buckets = createBuckets()) => {
  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const repositories = {
    assetRepo: assets,
    resourceRepo: resources,
    uploadSessionRepo: uploadSessions,
  };

  const definition: Definition = { buckets, resources: {} };
  const service = new AssetService<AssetServiceContext>(
    { ...repositories, definition, isInTransaction: false },
    transaction,
  );

  return { service, buckets, repositories };
};

/** Uploads the object the client stored, with metadata that matches `claims`. */
const givenUploadedObject = (
  buckets: ReturnType<typeof createBuckets>,
  overrides: Partial<PutObjectInput> = {},
) =>
  buckets[UPLOAD_BUCKET].storage.put({
    key: UPLOAD_KEY,
    body: new Uint8Array(claims.size),
    contentType: claims.mimeType,
    checksum: { hashAlgorithm: claims.hashAlgorithm, hashHex: claims.hashHex },
    ...overrides,
  });

/** An asset row plus the object it points at, so it can be deduplicated against. */
const givenAsset = async (
  repositories: ReturnType<typeof givenService>["repositories"],
  buckets: ReturnType<typeof createBuckets>,
  overrides: Partial<Asset> = {},
) => {
  const asset = await repositories.assetRepo.insert({
    bucket: ASSET_BUCKET,
    key: `assets/${crypto.randomUUID()}`,
    ...claims,
    ...overrides,
  });

  buckets[ASSET_BUCKET].storage.put({
    key: asset.key,
    body: new Uint8Array(asset.size),
    contentType: asset.mimeType,
    checksum: { hashAlgorithm: asset.hashAlgorithm, hashHex: asset.hashHex },
  });

  return asset;
};

const givenResource = (
  repositories: ReturnType<typeof givenService>["repositories"],
  assetId: string,
) =>
  repositories.resourceRepo.insert({
    assetId,
    owner: { userId: "u_1" },
    kind: "userAvatar",
    label: null,
    fileName: "cat.png",
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  });

describe("AssetService", () => {
  describe("verifyUploadClaims", () => {
    it("returns the stored object when every claim matches", async () => {
      const { service, buckets } = givenService();
      await givenUploadedObject(buckets);

      await expect(
        service.verifyUploadClaims({ uploadKey: UPLOAD_KEY, ...claims }).unwrap(),
      ).resolves.toMatchObject({
        key: UPLOAD_KEY,
        size: claims.size,
        contentType: claims.mimeType,
      });
    });

    it("reports a missing object as not found", async () => {
      const { service } = givenService();

      await expect(
        service.verifyUploadClaims({ uploadKey: UPLOAD_KEY, ...claims }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        details: { objectKey: UPLOAD_KEY },
      });
    });

    it("accepts storage that reports no checksum", async () => {
      const { service, buckets } = givenService();
      await givenUploadedObject(buckets, { checksum: undefined });

      await expect(
        service.verifyUploadClaims({ uploadKey: UPLOAD_KEY, ...claims }).unwrap(),
      ).resolves.toMatchObject({ key: UPLOAD_KEY });
    });

    const mismatches: ReadonlyArray<{
      claim: string;
      stored: Partial<PutObjectInput>;
      message: string;
    }> = [
      {
        claim: "size",
        stored: { body: new Uint8Array(claims.size + 1) },
        message: "Object size mismatch",
      },
      {
        claim: "mimeType",
        stored: { contentType: "image/jpeg" },
        message: "Object mimeType mismatch",
      },
      {
        claim: "checksum algorithm",
        stored: { checksum: { hashAlgorithm: "sha512", hashHex: claims.hashHex } },
        message: "Object checksum hashAlgorithm mismatch",
      },
      {
        claim: "checksum value",
        stored: { checksum: { hashAlgorithm: "sha256", hashHex: "b".repeat(64) } },
        message: "Object checksum hashHex mismatch",
      },
    ];

    it.for(mismatches)("rejects a mismatched $claim", async ({ stored, message }) => {
      const { service, buckets } = givenService();
      await givenUploadedObject(buckets, stored);

      await expect(
        service.verifyUploadClaims({ uploadKey: UPLOAD_KEY, ...claims }).unwrap(),
      ).rejects.toMatchObject({ code: ServiceErrorCode.PRECONDITION_FAILED, message });
    });
  });

  describe("delete", () => {
    it("removes the object, the resources and the asset", async () => {
      const { service, buckets, repositories } = givenService();
      const asset = await givenAsset(repositories, buckets);
      await givenResource(repositories, asset.id);

      await expect(service.delete(asset.id).unwrap()).resolves.toBeUndefined();

      await expect(buckets[ASSET_BUCKET].storage.head(asset.key)).resolves.toBeNull();
      await expect(repositories.assetRepo.findById(asset.id)).resolves.toBeNull();
      await expect(repositories.resourceRepo.findMany({ assetId: asset.id })).resolves.toEqual([]);
    });

    it("reports an unknown asset as not found", async () => {
      const assetId = crypto.randomUUID();

      await expect(givenService().service.delete(assetId).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        details: { assetId },
      });
    });

    it("leaves the rows untouched when the object cannot be removed", async () => {
      const buckets = createBuckets();
      buckets[ASSET_BUCKET] = {
        ...buckets[ASSET_BUCKET],
        storage: new UnavailableBucket(ASSET_BUCKET),
      };

      const { service, repositories } = givenService(buckets);

      const asset = await givenAsset(repositories, buckets);
      const resource = await givenResource(repositories, asset.id);

      await expect(service.delete(asset.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.UNAVAILABLE,
        details: { type: "storageError", code: StorageErrorCode.UNAVAILABLE },
      });

      // The object is deleted before any row, so a failed delete is safe to retry.
      await expect(repositories.assetRepo.findById(asset.id)).resolves.toEqual(asset);
      await expect(repositories.resourceRepo.findById(resource.id)).resolves.toEqual(resource);
    });
  });

  describe("promote", () => {
    /** Promotes the uploaded object into the asset bucket, under {@link DESTINATION_KEY}. */
    const givenPromotion = (
      service: AssetService<AssetServiceContext>,
      overrides: Readonly<{ destinationBucket?: string; destinationKey?: string }> = {},
    ) =>
      service.promote({
        uploadKey: UPLOAD_KEY,
        destinationBucket: ASSET_BUCKET,
        destinationKey: DESTINATION_KEY,
        ...claims,
        ...overrides,
      });

    it("copies the upload into the destination bucket and records the asset", async () => {
      const { service, buckets, repositories } = givenService();
      await givenUploadedObject(buckets);

      const asset = await givenPromotion(service).unwrap();

      expect(asset).toMatchObject({ bucket: ASSET_BUCKET, key: DESTINATION_KEY, ...claims });
      await expect(buckets[ASSET_BUCKET].storage.head(DESTINATION_KEY)).resolves.not.toBeNull();
      await expect(repositories.assetRepo.findById(asset.id)).resolves.toEqual(asset);
    });

    it("returns the existing asset instead of copying a duplicate", async () => {
      const { service, buckets, repositories } = givenService();
      await givenUploadedObject(buckets);
      const existing = await givenAsset(repositories, buckets);

      const asset = await givenPromotion(service).unwrap();

      expect(asset).toEqual(existing);
      await expect(buckets[ASSET_BUCKET].storage.head(DESTINATION_KEY)).resolves.toBeNull();
      await expect(
        repositories.assetRepo.findMany({ hashHex: claims.hashHex }),
      ).resolves.toHaveLength(1);
    });

    it("restores the object when a duplicate row has lost it", async () => {
      const { service, buckets, repositories } = givenService();
      await givenUploadedObject(buckets);

      // A row whose object is gone, keeping its own content type on the record.
      const stale = await repositories.assetRepo.insert({
        bucket: ASSET_BUCKET,
        key: "assets/gone.png",
        ...claims,
        mimeType: "image/jpeg",
      });

      await expect(givenPromotion(service).unwrap()).resolves.toEqual(stale);

      // The upload went back where the row points, with the row's metadata, and
      // no second row was created.
      await expect(buckets[ASSET_BUCKET].storage.head(stale.key)).resolves.toMatchObject({
        contentType: "image/jpeg",
      });
      await expect(buckets[ASSET_BUCKET].storage.head(DESTINATION_KEY)).resolves.toBeNull();
      await expect(
        repositories.assetRepo.findMany({ hashHex: claims.hashHex }),
      ).resolves.toHaveLength(1);
    });

    it("refuses an upload whose claims do not match", async () => {
      const { service, buckets, repositories } = givenService();
      await givenUploadedObject(buckets, { body: new Uint8Array(claims.size + 1) });

      await expect(givenPromotion(service).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Object size mismatch",
      });

      await expect(buckets[ASSET_BUCKET].storage.head(DESTINATION_KEY)).resolves.toBeNull();
      await expect(repositories.assetRepo.findMany({ hashHex: claims.hashHex })).resolves.toEqual(
        [],
      );
    });

    it("refuses an unknown destination bucket", async () => {
      const { service } = givenService();

      await expect(
        givenPromotion(service, { destinationBucket: "nowhere" }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Bucket not found",
        details: { key: "nowhere" },
      });
    });
  });

  describe("createUploadUrl", () => {
    it("issues the url from the upload bucket, pinned to the claims", async () => {
      const { service } = givenService();

      const request = await service
        .createUploadUrl({ uploadKey: UPLOAD_KEY, expiresInSeconds: 60, ...claims })
        .unwrap();

      expect(request).toMatchObject({
        url: `memory://${UPLOAD_BUCKET}/${UPLOAD_KEY}`,
        method: "PUT",
        headers: { "content-type": claims.mimeType },
      });
      expect(Date.parse(request.expiresAt)).toBeGreaterThan(Date.now());
    });

    it("issues a url the client can redeem into the upload bucket", async () => {
      const { service, buckets } = givenService();

      const request = await service
        .createUploadUrl({ uploadKey: UPLOAD_KEY, expiresInSeconds: 60, ...claims })
        .unwrap();

      await buckets[UPLOAD_BUCKET].storage.putPresigned(request, new Uint8Array(claims.size));

      await expect(buckets[UPLOAD_BUCKET].storage.head(UPLOAD_KEY)).resolves.toMatchObject({
        size: claims.size,
        contentType: claims.mimeType,
      });
    });
  });

  describe("createDownloadUrl", () => {
    /** The asset bucket kept public, for the access-policy cases. */
    const createPublicBuckets = () => ({
      [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
      [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET, {
        access: BucketAccessPolicy.PUBLIC,
      }),
    });

    it("signs a url for a private bucket", async () => {
      const { service, buckets, repositories } = givenService();
      const asset = await givenAsset(repositories, buckets);

      const download = await service.createDownloadUrl({ asset, expiresInSeconds: 60 }).unwrap();
      if (download.type !== "signed") throw new Error("expected a signed url");

      expect(download).toMatchObject({
        url: `memory://${ASSET_BUCKET}/${asset.key}`,
        method: "GET",
      });
      expect(Date.parse(download.expiresAt)).toBeGreaterThan(Date.now());
    });

    it("hands out the public url of a public bucket", async () => {
      const { service, buckets, repositories } = givenService(createPublicBuckets());
      const asset = await givenAsset(repositories, buckets);

      const download = await service.createDownloadUrl({ asset, expiresInSeconds: 60 }).unwrap();

      expect(download).toEqual({
        type: "public",
        url: `memory://${ASSET_BUCKET}/${asset.key}`,
      });
    });

    it("falls back to signing when a public bucket offers no public url", async () => {
      class NoPublicUrlBucket extends MemoryBucket {
        override getPublicUrl(): null {
          return null;
        }
      }

      const { service, buckets, repositories } = givenService({
        [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
        [ASSET_BUCKET]: {
          access: BucketAccessPolicy.PUBLIC,
          storage: new NoPublicUrlBucket(ASSET_BUCKET),
        },
      });
      const asset = await givenAsset(repositories, buckets);

      const download = await service.createDownloadUrl({ asset, expiresInSeconds: 60 }).unwrap();

      expect(download).toMatchObject({ type: "signed", method: "GET" });
    });

    it("issues a signed url the bucket can serve", async () => {
      const { service, buckets, repositories } = givenService();
      const asset = await givenAsset(repositories, buckets);

      const download = await service.createDownloadUrl({ asset, expiresInSeconds: 60 }).unwrap();
      if (download.type !== "signed") throw new Error("expected a signed url");

      await expect(
        buckets[ASSET_BUCKET].storage.getPresigned({
          url: download.url,
          method: "GET",
          expiresAt: download.expiresAt,
        }),
      ).resolves.toMatchObject({ key: asset.key });
    });

    it("refuses a bucket it does not know", async () => {
      const { service, buckets, repositories } = givenService();
      const asset = await givenAsset(repositories, buckets);

      await expect(
        service
          .createDownloadUrl({ asset: { ...asset, bucket: "nowhere" }, expiresInSeconds: 60 })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Bucket not found",
        details: { key: "nowhere" },
      });
    });
  });
});
