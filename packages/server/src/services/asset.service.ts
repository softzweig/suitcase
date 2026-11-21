import type { Asset, AssetData, AssetDownloadUrl, AssetHash } from "@softzweig/suitcase-core";
import { AssetStatus } from "@softzweig/suitcase-core";
import { BucketAccessPolicy } from "../storage/storage.access-policy.js";
import { UPLOAD_BUCKET_KEY } from "../storage/storage.buckets.js";
import type { Definition } from "../suitcase.js";
import { ServiceError } from "./service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "./service.js";

export type AssetServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition>;

type UploadVerificationArgs = AssetData & {
  /** The key in the target upload storage bucket. {@link UPLOAD_BUCKET_KEY} */
  uploadKey: string;
};

/** Which asset to link, for how long. */
export type AssetDownloadUrlInput = Readonly<{
  asset: Asset;
  /** When the download URL expires in seconds. */
  expiresInSeconds: number;
}>;

/** Which asset to delete. */
export type AssetDeleteInput = Readonly<{ assetId: string }>;

/** What {@link AssetService.markDeleted} did, or why it did nothing. */
export type AssetMarkResult =
  | { readonly marked: true; readonly asset: Asset }
  | { readonly marked: false; readonly reason: "referenced" | "inactive" };

export class AssetService<
  TCtx extends AssetServiceContext = AssetServiceContext,
> extends SuitcaseService<TCtx> {
  /** A bucket config from the active definition; unknown keys are refused. */
  private async getBucket(context: Readonly<TCtx>, key: string) {
    const bucket = await context.definition.buckets[key];
    ServiceError.assertPrecondition(bucket, "Bucket not found", { key });
    return bucket;
  }

  /** The bucket uploads land in; every definition declares one. */
  private async getUploadBucket(context: Readonly<TCtx>) {
    return this.getBucket(context, UPLOAD_BUCKET_KEY);
  }

  /** Finds the first duplicate based on the given asset hash and bucket */
  findDuplicate({ bucket, hashAlgorithm, hashHex }: AssetHash & { bucket: string }) {
    return this.context.assetRepo.findOne({ hashAlgorithm, hashHex, bucket });
  }

  /**
   * Revives an asset that was marked deleted, when its bytes turn out to be needed again.
   *
   * @note
   * The state goes back to active first and the object is checked after: a purge may have taken
   * the bytes between the mark and this revival, and then the mark goes back rather than leaving
   * an active row nobody can read. Until that happens a marked row still owns its object, so
   * reusing the content is cheaper than a second row for the same bytes.
   *
   * @human
   */
  revive(asset: Asset) {
    return this.nontransactional(async function (ctx) {
      if (asset.status !== AssetStatus.DELETED) return asset;

      const revived = await ctx.assetRepo.patch(asset.id, {
        status: AssetStatus.ACTIVE,
        deletedAt: null,
      });

      const bucket = await this.getBucket(ctx, revived.bucket);
      const object = await bucket.storage.head(revived.key);

      if (!object) {
        // A retry promotes the upload again, repairs the object through the stale-row branch and
        // revives on the way out, so the mark is the honest state until then.
        await ctx.assetRepo.patch(asset.id, {
          status: AssetStatus.DELETED,
          deletedAt: asset.deletedAt,
        });
      }

      ServiceError.assertPrecondition(object, "Asset object missing", {
        assetId: revived.id,
        objectKey: revived.key,
      });

      return revived;
    });
  }

  /**
   * Marks an asset deleted, but only while nothing references it: an active resource must never
   * point at a marked asset. Idempotent, the first mark keeps its timestamp and a later one is a
   * no-op. The bytes stay until the purge runs, and a reuse revives the mark through {@link revive}.
   *
   * **Note: this is the primary way assets are deleted, and also the recommended path.**
   *
   * @note
   * Runs on whichever context the service is bound to, so a caller inside a transaction marks the
   * asset in that same transaction rather than after it. The reference read is not a lock: a
   * concurrent upload revives the asset through {@link promote}, and the purge rechecks before it
   * removes anything.
   *
   * @human
   */
  markDeleted({ assetId }: AssetDeleteInput) {
    return this.execute(async (ctx): Promise<AssetMarkResult> => {
      const [referenced] = await ctx.resourceRepo.findMany({ assetId });

      if (referenced) return { marked: false, reason: "referenced" };

      const [marked] = await ctx.assetRepo.patchWhere(
        { id: assetId, status: AssetStatus.ACTIVE },
        { status: AssetStatus.DELETED, deletedAt: new Date().toISOString() },
      );

      if (!marked) return { marked: false, reason: "inactive" };

      return { marked: true, asset: marked };
    });
  }

  /**
   * Deletes an asset outright: the object, **every resource pointing at it**, and the row.
   *
   * This is the destructive escape hatch, not the normal delete. Deleting a resource marks its
   * asset through {@link markDeleted} and lets the purge take the bytes out of band; this one
   * skips the mark, skips the reference check and, on purpose, skips the resource kinds' owner
   * authorizers, so whoever calls it must have authorized the cascade themselves.
   *
   * @human
   */
  forceDelete({ assetId }: AssetDeleteInput) {
    return this.nontransactional(async function (ctx) {
      const asset = await ctx.assetRepo.findById(assetId);
      ServiceError.assertOrNotFound(asset, "Asset not found", { assetId });

      // We delete the object first, as its idempotency allows safe retries e.g.
      // through dead-letter-queues in the future ~vz
      const bucket = await this.getBucket(ctx, asset.bucket);
      await bucket.storage.remove(asset.key); // idempotent

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
      const targetBucket = await this.getBucket(ctx, destinationBucket);
      const uploadBucket = await this.getUploadBucket(ctx);

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
        return this.revive(duplicateAsset).unwrap();
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

        return this.revive(duplicateAsset).unwrap();
      }

      // No existing asset found, promotion is valid
      await uploadBucket.storage.copy({
        sourceKey: uploadKey,
        destinationBucket: targetBucket.storage,
        destinationKey,
        contentType: object.contentType,
      });

      return ctx.assetRepo.insert({
        status: AssetStatus.ACTIVE,
        deletedAt: null,
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
    return this.nontransactional(async function (ctx) {
      const bucket = await this.getUploadBucket(ctx);
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

  createDownloadUrl({ asset, expiresInSeconds }: AssetDownloadUrlInput) {
    return this.nontransactional(async function (ctx) {
      const bucket = await this.getBucket(ctx, asset.bucket);

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
    return this.nontransactional(async function (ctx) {
      const uploadBucket = await this.getUploadBucket(ctx);
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
