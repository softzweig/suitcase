import type { Asset, AssetData, AssetDownloadUrl, AssetHash } from "@softzweig/suitcase-core";
import { BucketAccessPolicy } from "../storage/storage.access-policy.js";
import type { SuitcaseBucketRegistry, SuitcaseBuckets } from "../storage/storage.buckets.js";
import { ServiceError } from "./service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "./service.js";

export type AssetServiceContext<TBuckets extends SuitcaseBuckets = SuitcaseBuckets> =
  SuitcaseServiceContext & { buckets: SuitcaseBucketRegistry<TBuckets> };

type UploadVerificationArgs = AssetData & {
  /** The objectKey in the target upload storage bucket. @see {@link SuitcaseBucketRegistry.getUploadBucket} */
  uploadKey: string;
};

export class AssetService<
  TCtx extends AssetServiceContext = AssetServiceContext,
> extends SuitcaseService<TCtx> {
  /** Finds the first duplicate based on the given asset hash and bucket */
  findDuplicate({ bucket, hashAlgorithm, hashHex }: AssetHash & { bucket: string }) {
    return this.context.assetRepo.findOne({ hashAlgorithm, hashHex, bucket });
  }

  delete(assetId: string) {
    return this.nontransactional(async function (ctx) {
      const asset = await ctx.assetRepo.findById(assetId);
      ServiceError.assertOrNotFound(asset, "Asset not found", { assetId });

      // We delete the object first, as its idempotency allows safe retries e.g.
      // through dead-letter-queues in the future ~vz
      await ctx.buckets.getBucket(asset.bucket).storage.remove(asset.key); // idempotent

      await this.transaction(async (ctx) => {
        // The asset owns its resources and the repository contract guarantees no
        // cascades, so dependents are deleted explicitly, on every adapter ~vz
        await ctx.resourceRepo.deleteWhere({ assetId });
        await ctx.assetRepo.delete([assetId]);
      });
    });
  }

  promote({
    uploadKey,
    destinationKey,
    destinationBucket,
    ...args
  }: UploadVerificationArgs & {
    destinationBucket: string;
    /** The key for the target bucket location */
    destinationKey: string;
  }) {
    return this.nontransactional(async function (ctx) {
      const targetBucket = ctx.buckets.getBucket(destinationBucket);
      const uploadBucket = ctx.buckets.getUploadBucket();

      // Verifies the upload claims
      const object = await this.verifyUploadClaims({ uploadKey, ...args }).unwrap();

      const duplicateAsset = await this.findDuplicate({
        bucket: targetBucket.storage.getName(),
        ...args,
      });

      // A duplicate row can outlive its object; the branch below repairs that
      const duplicateObject = duplicateAsset
        ? await targetBucket.storage.head(duplicateAsset.key)
        : null;

      if (duplicateAsset && duplicateObject) {
        // Existing asset found, deduplication; no promotion needed
        return duplicateAsset;
      }

      if (duplicateAsset) {
        // The row outlived its object. The upload is the same content (the hash
        // was verified) so restore it where the row points rather than failing a
        // caller who cannot do anything about it. Worth a metric: it means the
        // backend lost an object. Potentially consider future logging??
        await uploadBucket.storage.copy({
          sourceKey: uploadKey,
          destinationBucket: targetBucket.storage,
          destinationKey: duplicateAsset.key,
          contentType: duplicateAsset.mimeType,
        });

        return duplicateAsset;
      }

      // No existing asset found, promotion is valid
      await uploadBucket.storage.copy({
        sourceKey: uploadKey,
        destinationBucket: targetBucket.storage,
        destinationKey,
        contentType: object.contentType,
      });

      return ctx.assetRepo.insert({
        bucket: targetBucket.storage.getName(),
        key: destinationKey,
        ...args,
      });
    });
  }

  /**
   * Verifies the upload claims for an asset, ensuring the object exists in the upload bucket
   * and its properties match the expected values and then also returned the `StoredObject`.
   *
   * While this is a good approach in general, it is not strictly necessary when the underlying
   * implementation correctly uses S3 storage semantics, instead of custom alternatives.
   * This is because the underlying storage solution should use signing to ensure the integrity
   * of physical files, to make sure no abuse is directly possible.
   *
   * This is mostly a sanity check, although it can be argued that it's the domains full
   * responsibility to verify "claims".
   *
   * @human
   */
  verifyUploadClaims({
    uploadKey: objectKey,
    hashAlgorithm,
    hashHex,
    mimeType,
    size,
  }: UploadVerificationArgs) {
    return this.nontransactional(async function () {
      const bucket = this.context.buckets.getUploadBucket();
      const object = await bucket.storage.head(objectKey);
      ServiceError.assertOrNotFound(object, "Object not found", { objectKey });

      // Ensure file size matches
      ServiceError.assertPrecondition(object.size === size, "Object size mismatch", {
        objectKey,
        expected: size,
        actual: object.size,
      });

      // Ensure mimeType matches
      ServiceError.assertPrecondition(object.contentType === mimeType, "Object mimeType mismatch", {
        objectKey,
        expected: mimeType,
        actual: object.contentType,
      });

      // Ensure Checksum matches
      ServiceError.assertPrecondition(
        !object.checksum || object.checksum?.hashAlgorithm === hashAlgorithm,
        "Object checksum hashAlgorithm mismatch",
        { objectKey, expected: hashAlgorithm, actual: object.checksum?.hashAlgorithm },
      );

      ServiceError.assertPrecondition(
        !object.checksum || object.checksum?.hashHex === hashHex,
        "Object checksum hashHex mismatch",
        { objectKey, expected: hashHex, actual: object.checksum?.hashHex },
      );

      return object;
    });
  }

  createDownloadUrl({
    asset,
    expiresInSeconds,
  }: Readonly<{
    asset: Asset;
    /** When the download URL expires in seconds. */
    expiresInSeconds: number;
  }>) {
    return this.nontransactional(async function () {
      const bucket = this.context.buckets.getBucket(asset.bucket);

      // There is a rare occurrence where a bucket is public but the object does
      // not have a public URL. This violates the expectation, but we handle this
      // gracefully by falling back to private access.
      const publicUrl = bucket.storage.getPublicUrl(asset.key);
      const access = publicUrl ? bucket.access : BucketAccessPolicy.PRIVATE;

      switch (access) {
        case BucketAccessPolicy.PRIVATE:
          return {
            type: "signed",
            ...(await bucket.storage.createDownloadUrl({
              key: asset.key,
              expiresInSeconds,
            })),
          } as const satisfies AssetDownloadUrl;
        case BucketAccessPolicy.PUBLIC:
          ServiceError.assertPrecondition(publicUrl, "Public URL not available", {
            assetId: asset.id,
            objectKey: asset.key,
          });
          return {
            type: "public",
            url: publicUrl,
          } as const satisfies AssetDownloadUrl;
      }
    });
  }

  createUploadUrl({
    uploadKey,
    hashAlgorithm,
    hashHex,
    mimeType,
    size,
    expiresInSeconds,
  }: AssetData & {
    uploadKey: string;
    expiresInSeconds: number;
  }) {
    return this.nontransactional(async function () {
      const uploadBucket = this.context.buckets.getUploadBucket();
      return uploadBucket.storage.createUploadUrl({
        key: uploadKey,
        checksum: { hashAlgorithm, hashHex },
        contentType: mimeType,
        contentLength: size,
        expiresInSeconds,
      });
    });
  }
}
