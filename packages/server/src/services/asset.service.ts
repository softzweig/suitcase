import { SpindleErrorCode } from "@softzweig/spindle-core/result";
import {
  Service,
  ServiceError,
  type ServiceExecutionContract,
} from "@softzweig/spindle-core/service";
import type { Asset, AssetData, AssetDownloadUrl, AssetHash } from "@softzweig/suitcase-core";
import { AssetStatus } from "@softzweig/suitcase-core";
import type { JobQueue } from "@softzweig/suitcase-job-queue";
import type { SuitcaseJobs } from "../jobs.js";
import { BucketAccessPolicy } from "../storage/storage.access-policy.js";
import { UPLOAD_BUCKET_KEY } from "../storage/storage.buckets.js";
import type { Definition } from "../suitcase.js";
import type { SuitcaseServiceContext } from "./service.js";

export type AssetServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition> & {
    /** Where the work that outlives a delete goes, such as purging a marked asset's bytes. */
    jobs: JobQueue<SuitcaseJobs>;
  };

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

/** Which uploaded object to remove from the upload bucket. */
export type UploadPurgeInput = Readonly<{ key: string }>;

/** What {@link AssetService.markDeleted} did, or why it did nothing. */
export type AssetMarkResult =
  | { marked: true; asset: Asset }
  | { marked: false; reason: "referenced" | "inactive" };

/** What {@link AssetService.purge} did, or why it left the asset alone. */
export type AssetPurgeResult =
  | { purged: true; asset: Asset }
  | { purged: false; reason: "missing" | "referenced" | "inactive" };

export class AssetService<TCtx extends AssetServiceContext = AssetServiceContext>
  extends Service<TCtx>
  implements ServiceExecutionContract<AssetService<TCtx>>
{
  /** A bucket config from the active definition; unknown keys are refused. */
  private async getBucket(context: Readonly<TCtx>, key: string) {
    const bucket = await context.definition.buckets[key];
    ServiceError.assert(bucket, "Bucket not found", { key });
    return bucket;
  }

  /** The bucket uploads land in; every definition declares one. */
  private async getUploadBucket(context: Readonly<TCtx>) {
    return this.getBucket(context, UPLOAD_BUCKET_KEY);
  }

  /**
   * Finds the asset whose bytes could back a new upload, so a duplicate is reused instead of
   * stored twice. A claimed asset is not one of them: its bytes are on their way out, and only
   * {@link purge} knows whether they are still there.
   */
  findReusableDuplicate({ bucket, hashAlgorithm, hashHex }: AssetHash & { bucket: string }) {
    return this.prepare((ctx) =>
      ctx.assetRepo.findOne({
        hashAlgorithm,
        hashHex,
        bucket,
        // We allow reviving deleted assets, so we include them in the search.
        // Revive makes sure the underlying asset actually is still alive and is not currently
        // being deleted, so we can safely reuse its bytes and assume they are still valid. ~vz
        status: [AssetStatus.ACTIVE, AssetStatus.DELETED],
      }),
    );
  }

  /**
   * Revives an asset that was marked deleted, when its bytes turn out to be needed again.
   *
   * @note
   * Claiming the revival is a compare-and-set on the mark, so it and a purge cannot both win:
   * whichever patches the row first decides, and the other has to look at the outcome. The state
   * goes back to active before the object is checked, because a purge may have taken the bytes
   * between the mark and this revival, and then the mark goes back rather than leaving an active
   * row nobody can read. Until that happens a marked row still owns its object, so reusing the
   * content is cheaper than a second row for the same bytes.
   *
   * @human
   */
  revive(asset: Asset) {
    return this.prepareNonTransaction(async function (ctx) {
      if (asset.status === AssetStatus.ACTIVE) {
        return asset;
      }

      const [revived] = await ctx.assetRepo.patchWhere(
        { id: asset.id, status: AssetStatus.DELETED },
        { status: AssetStatus.ACTIVE, deletedAt: null },
      );

      if (!revived) {
        // A purge claimed it first, or a concurrent revival already flipped it back.
        const current = await ctx.assetRepo.findById(asset.id);
        if (current?.status === AssetStatus.ACTIVE) return current;

        throw new ServiceError(SpindleErrorCode.PRECONDITION_FAILED, "Asset is not available", {
          assetId: asset.id,
          status: current?.status ?? null,
        });
      }

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

      ServiceError.assert(object, "Asset object missing", {
        assetId: revived.id,
        objectKey: revived.key,
      });

      return revived;
    });
  }

  /**
   * Marks an asset deleted and queues its purge.
   *
   * Nothing may point at the asset, so this is the normal end of a delete: a marked asset is
   * never read, and a reuse revives it through {@link revive}. Idempotent, the first mark keeps
   * its timestamp and a later one is a no-op. The bytes stay until the purge runs, which is what
   * the job is for.
   *
   * **Note: this is the primary way assets are (_potentially_) deleted, and also the recommended path.**
   *
   * @important
   * Opens its own transaction, so it must not be called from inside one. The purge is queued once
   * that transaction has committed, because the job can run immediately and has to find the mark
   * visible; a caller's open transaction would hide it until the job had already given up.
   *
   * @human
   */
  markDeleted({ assetId }: AssetDeleteInput) {
    return this.prepareNonTransaction(async function (ctx) {
      const mark = await this.transaction(async (ctx): Promise<AssetMarkResult> => {
        if (await ctx.resourceRepo.exists({ assetId })) {
          return { marked: false, reason: "referenced" };
        }

        const [marked] = await ctx.assetRepo.patchWhere(
          { id: assetId, status: AssetStatus.ACTIVE },
          { status: AssetStatus.DELETED, deletedAt: new Date().toISOString() },
        );

        if (!marked) return { marked: false, reason: "inactive" };

        return { marked: true, asset: marked };
      });

      // Only now, with the mark's transaction committed: the job may start before this returns.
      // A job enqueue could run the purge immediately, but that would involve deadlocking on
      // the transaction, so we apply the transaction only after it has committed. ~vz
      if (mark.marked) {
        await ctx.jobs.enqueue("assets.purge", { assetId: mark.asset.id });
      }

      return mark;
    });
  }

  /**
   * Removes a marked asset's bytes and its row, the work the mark was asking for.
   *
   * The mark is only a statement of intent, so the purge claims the row with a compare-and-set
   * and rechecks everything before it touches the bytes: an asset revived since it was marked is
   * left alone, one another resource still points at keeps its bytes until the last of them goes,
   * and one that is already gone is nothing to do. The claim is what keeps a revival from handing
   * out bytes this run is about to remove.
   *
   * @note
   * The purge is idempotent, and that includes a run that never finished: a crash between the
   * claim and the row delete leaves the asset `purging`, so the next run may re-claim it. Two
   * purges over the same asset are harmless (removing the object and the row are idempotent) and
   * the object goes first for the same reason, so the retry finishes the job instead of failing on
   * the missing object.
   *
   * @see {@link markDeleted}
   * @human
   */
  purge({ assetId }: AssetDeleteInput) {
    return this.prepareNonTransaction(async function (ctx): Promise<AssetPurgeResult> {
      const [claimed] = await ctx.assetRepo.patchWhere(
        { id: assetId, status: [AssetStatus.DELETED, AssetStatus.PURGING] },
        { status: AssetStatus.PURGING },
      );

      if (!claimed) {
        const asset = await ctx.assetRepo.findById(assetId);
        return { purged: false, reason: asset ? "inactive" : "missing" };
      }

      if (await ctx.resourceRepo.exists({ assetId })) {
        // Not purged after all, so the claim goes back to the mark and a later job can take it.
        await ctx.assetRepo.patch(assetId, { status: AssetStatus.DELETED });
        return { purged: false, reason: "referenced" };
      }

      const bucket = await this.getBucket(ctx, claimed.bucket);
      await bucket.storage.remove(claimed.key);

      await ctx.assetRepo.delete([assetId]);

      return { purged: true, asset: claimed };
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
    return this.prepareNonTransaction(async function (ctx) {
      const asset = await ctx.assetRepo.findById(assetId);
      ServiceError.assert(asset, "Asset not found", { assetId }, SpindleErrorCode.NOT_FOUND);

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
    return this.prepareNonTransaction(async function (ctx) {
      const targetBucket = await this.getBucket(ctx, destinationBucket);
      const uploadBucket = await this.getUploadBucket(ctx);

      // Verifies the upload claims
      const object = await this.verifyUploadClaims({ uploadKey, ...args }).unwrap();

      // Whose bytes these already are, whatever the row's state says: a claimed one still holds
      // the digest, so it has to be refused here rather than collide with the unique index.
      const duplicateAsset = await ctx.assetRepo.findOne({
        bucket: targetBucket.storage.getName(),
        hashAlgorithm: args.hashAlgorithm,
        hashHex: args.hashHex,
      });

      // A purge claimed the row, so its bytes are on their way out: reviving it would race the
      // removal, and copying to its key would leave an object nobody points at. The caller
      // retries, and by then the row is gone and the upload becomes a fresh asset.
      ServiceError.assert(duplicateAsset?.status !== AssetStatus.PURGING, "Asset is being purged", {
        hashHex: args.hashHex,
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
   * Removes the object a completed upload left in the upload bucket.
   *
   * Finalize copies the bytes into the kind's bucket before this is queued, so the source is
   * expendable. Removal is idempotent: a missing object, an already cleaned upload, or a retry
   * all succeed.
   */
  purgeUpload({ key }: UploadPurgeInput) {
    return this.prepareNonTransaction(async function (ctx) {
      const bucket = await this.getUploadBucket(ctx);
      await bucket.storage.remove(key);
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
    return this.prepareNonTransaction(async function (ctx) {
      const bucket = await this.getUploadBucket(ctx);
      const object = await bucket.storage.head(objectKey);
      ServiceError.assert(object, "Object not found", { objectKey }, SpindleErrorCode.NOT_FOUND);

      // Ensure file size matches
      ServiceError.assert(object.size === size, "Object size mismatch", {
        objectKey,
        expected: size,
        actual: object.size,
      });

      // Ensure mimeType matches
      ServiceError.assert(object.contentType === mimeType, "Object mimeType mismatch", {
        objectKey,
        expected: mimeType,
        actual: object.contentType,
      });

      // Ensure Checksum matches
      ServiceError.assert(
        !object.checksum || object.checksum?.hashAlgorithm === hashAlgorithm,
        "Object checksum hashAlgorithm mismatch",
        { objectKey, expected: hashAlgorithm, actual: object.checksum?.hashAlgorithm },
      );

      ServiceError.assert(
        !object.checksum || object.checksum?.hashHex === hashHex,
        "Object checksum hashHex mismatch",
        { objectKey, expected: hashHex, actual: object.checksum?.hashHex },
      );

      return object;
    });
  }

  createDownloadUrl({ asset, expiresInSeconds }: AssetDownloadUrlInput) {
    return this.prepareNonTransaction(async function (ctx) {
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
          ServiceError.assert(publicUrl, "Public URL not available", {
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
    return this.prepareNonTransaction(async function (ctx) {
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
