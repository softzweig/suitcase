import {
  Service,
  ServiceError,
  type ServiceExecutionContract,
} from "@softzweig/spindle-core/service";
import {
  type Asset,
  type AssetHash,
  type Resource,
  type ResourceOwner,
  type UploadIntent,
  type UploadSession,
  UploadStatus,
} from "@softzweig/suitcase-core";
import type { UploadClaims } from "@softzweig/suitcase-core/contracts";
import { ByteSize } from "@softzweig/suitcase-core/utils";
import type { JobQueue } from "@softzweig/suitcase-job-queue";
import type { SuitcaseJobs } from "../jobs.js";
import { UploadCleanupPolicy } from "../storage/storage.bucket.js";
import { DEFAULT_UPLOAD_CLEANUP_POLICY, UPLOAD_BUCKET_KEY } from "../storage/storage.buckets.js";
import {
  type Definition,
  findDefinitionResource,
  type InferDefinitionExecutionContext,
  type InferDefinitionResourceKinds,
  type InferDefinitionUploadIntent,
  type ResourceTransactionContext,
} from "../suitcase.js";
import type { AssetService, AssetServiceContext } from "./asset.service.js";
import { ResourceAction } from "./resource.authorizers.js";
import { decorateResourceMetadata, parseResourceMetadata } from "./resource.metadata.js";
import type { ResourceService } from "./resource.service.js";
import type { SuitcaseServiceContext } from "./service.js";
import {
  DEFAULT_UPLOAD_EXPIRY_SECONDS,
  DEFAULT_UPLOAD_REUSE_POLICY,
  type UploadReusePolicy,
} from "./upload.policy.js";

/**
 * Carries the asset service's own context, so a bound resource service can hand
 * that service a context it accepts; a sibling is only as good as the context it
 * can be rebound with.
 */
export type UploadServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition> & {
    assetService: AssetService<AssetServiceContext<TDefinition>>;
    resourceService: ResourceService<TDefinition>;
    createUploadKey: (uploadId: string) => string | Promise<string>;
    /** Where the upload bucket cleanup goes once finalize has copied the bytes. */
    jobs: JobQueue<SuitcaseJobs>;
  };

/**
 * What starting a session takes, as the backend's own callers supply it.
 *
 * Deliberately not the wire's request type: a transport may carry less than this, and the api
 * layer is where the two meet. The policy fields are here because the backend decides them, not
 * because a client may ask for them.
 */
export type UploadInitializeInput<
  TDefinition extends Definition,
  TKind extends InferDefinitionResourceKinds<TDefinition> & string,
  TIntent = undefined,
> = Readonly<{
  kind: TKind;
  claims: UploadClaims<TIntent>;
  execution: InferDefinitionExecutionContext<TDefinition>;
  /** How long the session stays open. The backend's choice, never the client's. */
  expiresInSeconds?: number;
  /** Whether bytes already stored may be reused. The backend's choice, never the client's. */
  reusePolicy?: UploadReusePolicy;
}>;

/** What finalizing takes: the session, the caller's context, and the reuse decision. */
export type UploadFinalizeInput<TDefinition extends Definition> = Readonly<{
  uploadId: string;
  execution: InferDefinitionExecutionContext<TDefinition>;
  /** Whether bytes already stored may be reused. The backend's choice, never the client's. */
  reusePolicy?: UploadReusePolicy;
}>;

export class UploadService<
    TDefinition extends Definition = Definition,
    TCtx extends UploadServiceContext<TDefinition> = UploadServiceContext<TDefinition>,
  >
  extends Service<TCtx>
  implements ServiceExecutionContract<UploadService<TDefinition, TCtx>>
{
  /**
   * Verifies the upload claims against the resource definition's criteria, such as maximum
   * size and allowed MIME types. This also calls the `accept` function in the resource definition
   * to determine whether the upload is acceptable.
   *
   * @human
   */
  verifyUploadConstraints<TKind extends InferDefinitionResourceKinds<TCtx["definition"]> & string>({
    kind,
    execution,
    claims,
    owner,
  }: Readonly<{
    kind: TKind;
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    claims: UploadClaims<UploadIntent | InferDefinitionUploadIntent<TDefinition, TKind>>;
    owner: ResourceOwner;
  }>) {
    return this.prepare(async (ctx) => {
      const resourceDefinition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assertFound(resourceDefinition, "Resource definition not found", { kind });

      const transaction = this.hookTransaction(ctx);

      const criteria = Object.freeze({
        maxSize: resourceDefinition.upload?.maxSize
          ? ByteSize.parse(resourceDefinition.upload.maxSize)
          : null,
        mimeTypes: resourceDefinition.upload?.mimeTypes ?? null,
      });

      // Only kinds that declare an intent schema can reject one; a kind without one accepts any
      // session, since nothing about the intent was ever promised to it.
      const intentSchema = resourceDefinition.upload?.intent;

      ServiceError.assert(
        !intentSchema || intentSchema.safeParse(claims.intent).success,
        "Invalid upload intent, or outdated (app-update, potentially retry)",
        { kind, claims },
      );

      const acceptFn = resourceDefinition.upload?.accept;

      if (acceptFn) {
        const verdict = await acceptFn({ claims, execution, owner, transaction });
        ServiceError.assertPermitted(verdict, { kind, claims });
      }

      ServiceError.assert(
        !criteria.maxSize || criteria.maxSize.gte(claims.size),
        "Upload exceeds maximum size",
        { kind, claims, maxSize: criteria.maxSize?.format() },
      );

      ServiceError.assert(
        !criteria.mimeTypes || criteria.mimeTypes.includes(claims.mimeType),
        "Upload has an unsupported MIME type",
        { kind, claims, mimeTypes: criteria.mimeTypes },
      );
    });
  }

  /**
   * Initializes a new upload session with given claims (user-defined).
   *
   * The claims are used to determine whether the upload session meets the constraints defined
   * for this resource, and the finalized uploaded file and claims will need to match the given
   * claims here exactly. The hash, size, and general asset-data that can be verified for
   * integrity, is verified for integrity. Thus, claims become a responsibility for a future
   * {@link finalize} call.
   *
   * Another advantage of the initialization step together with the verification claims is that
   * this function can also deduplicate the requested upload based on existing resources and
   * assets, possibly not requiring any further upload at all.
   *
   * This method does not actually upload the file; it only prepares a session that can be used
   * to perform the upload according to the defined constraints.
   *
   * Metadata is parsed against the kind's schema and passed through its decorator. The decorated
   * value is what the session records, so finalize never has to run the decorator again.
   *
   * @human
   */
  initialize<TKind extends InferDefinitionResourceKinds<TCtx["definition"]> & string>({
    kind,
    execution,
    expiresInSeconds = DEFAULT_UPLOAD_EXPIRY_SECONDS,
    claims,
    reusePolicy = DEFAULT_UPLOAD_REUSE_POLICY,
  }: UploadInitializeInput<
    TCtx["definition"],
    TKind,
    InferDefinitionUploadIntent<TCtx["definition"], TKind>
  >) {
    return this.prepareNonTransaction(async function (ctx) {
      const dateNow = new Date();
      const expiresAt = new Date(dateNow.getTime() + expiresInSeconds * 1000);

      const definition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assertFound(definition, "Resource definition not found", { kind });

      const upload = definition.upload;
      ServiceError.assertFound(upload, "Resource kind cannot be uploaded", { kind });

      // The owner resolver and the decorator run on parsed claims. Intent is parsed first so a
      // decorator cannot act on a shape the definition has not accepted.
      const intentSchema = upload.intent;
      const parsedIntent = intentSchema ? intentSchema.safeParse(claims.intent) : null;

      ServiceError.assert(
        !intentSchema || parsedIntent?.success,
        "Invalid upload intent, or outdated (app-update, potentially retry)",
        { kind, claims },
      );

      const metadata = parseResourceMetadata({
        claim: claims.metadata,
        kind,
        schema: upload.metadata,
      });

      const parsedClaims = {
        ...claims,
        ...(parsedIntent?.success ? { intent: parsedIntent.data } : {}),
        metadata,
      };

      const owner = await this.resolveOwner({
        claims: parsedClaims,
        execution,
        kind,
        transaction: ctx,
      }).unwrap();

      const finalClaims = {
        ...parsedClaims,
        metadata: await decorateResourceMetadata({
          action: ResourceAction.UPLOAD,
          claims: parsedClaims,
          execution,
          metadata,
          owner,
          transaction: this.hookTransaction(ctx),
          upload,
        }),
      };

      // Verify the claims against potential upload constraints defined for the resource
      await this.verifyUploadConstraints({
        claims: finalClaims,
        execution,
        owner,
        kind,
      }).unwrap();

      const dedupe = await this.transaction(async function (ctx) {
        const upload = await ctx.uploadSessionRepo.insert({
          ...finalClaims,
          intent: finalClaims.intent ?? null,
          metadata: finalClaims.metadata ?? null,
          createdAt: dateNow.toISOString(),
          expiresAt: expiresAt.toISOString(),
          kind,
          resourceId: null,
          status: UploadStatus.PENDING,
          updatedAt: null,
          owner,
        });

        const result = await this.deduplicateAndAuthorize({
          execution,
          upload,
          reusePolicy,
        }).unwrap();

        // Nothing has to be uploaded: the session resolves onto whatever already holds the bytes,
        // so it is completed here instead of being left pending with nothing left to do.
        if (result.candidate) {
          const resolved = await ctx.uploadSessionRepo.patch(upload.id, {
            resourceId: result.candidate.id,
            status: UploadStatus.COMPLETED,
          });

          return {
            upload: resolved,
            reuseCandidate: result.candidate,
            reuseAsset: result.asset,
            reused: true,
          } as const;
        }

        return {
          upload,
          reuseCandidate: null,
          reuseAsset: result.asset,
          reused: false,
        } as const;
      });

      if (dedupe.reuseCandidate) {
        return {
          upload: dedupe.upload,
          resource: dedupe.reuseCandidate,
          reused: true,
        } as const;
      }

      try {
        const uploadKey = await ctx.createUploadKey(dedupe.upload.id);
        const target = await ctx.assetService
          .createUploadUrl({ ...claims, expiresInSeconds, uploadKey })
          .unwrap();

        return {
          upload: dedupe.upload,
          reused: false,
          target,
        } as const;
      } catch (error) {
        await ctx.uploadSessionRepo.delete([dedupe.upload.id]);
        throw error;
      }
    });
  }

  /**
   * Finalizes an upload: claims the session, decides whether the bytes can be reused, then either
   * attaches the resource that already holds them or promotes the upload into a new one.
   *
   * Finalize is the actual verification step that ensures the upload meets all constraints,
   * the object is stored within the storage-layer correctly and its integrity is verified
   * against the initial upload constraints, and is re-evaluated against any deduplication,
   * reuse policies, and any other relevant authorizer defined in the Suitcase definition(s).
   *
   * This method ensures that the upload is either reused or promoted to a new resource,
   * depending on the deduplication and reuse policies.
   *
   * @see {@link initialize}
   * @human
   */
  finalize({
    execution,
    reusePolicy = DEFAULT_UPLOAD_REUSE_POLICY,
    uploadId,
  }: UploadFinalizeInput<TCtx["definition"]>) {
    return this.prepareNonTransaction(async function (ctx) {
      const upload = await ctx.uploadSessionRepo.findById(uploadId);
      ServiceError.assertFound(upload, "Upload session not found", { uploadId });

      ServiceError.assert(Date.parse(upload.expiresAt) > Date.now(), "Upload session has expired", {
        uploadId,
      });

      // Verify the claims against potential upload constraints defined for the resource.
      // It is not needed to verify against the actual stored object as that is the responsibility
      // from the asset service itself (i.e. handling stored objects and verifying integrity). ~vz
      await this.verifyUploadConstraints({
        claims: upload,
        execution,
        owner: upload.owner,
        kind: upload.kind,
      }).unwrap();

      // Claim and decide in one scope: the claim is a compare-and-set, so a second finalize of
      // this session stops there, and the authorizer decides on a session nobody else owns.
      let mutexAcquired = false;
      let created: Resource | null = null;

      try {
        const dedupe = await this.transaction(async function () {
          await this.lockUpload(upload).unwrap();
          mutexAcquired = true; // Only allow releases since we now hold the lock on this upload ~vz
          return this.deduplicateAndAuthorize({ execution, upload, reusePolicy }).unwrap();
        });

        // Reuse what the authorization approved, or else promote the bytes and create a resource of
        // their own. Either way this is the only authorization of the upload.
        const finalized =
          dedupe.candidate && dedupe.asset
            ? { asset: dedupe.asset, resource: dedupe.candidate, reused: true }
            : await this.createResourceFor(upload).unwrap();

        // Only a resource this attempt created is ours to take back; one that was reused or matched
        // an existing row belongs to whoever created it first, whether the deduplication found it
        // or the create returned it unchanged. ~vz
        created = finalized.reused ? null : finalized.resource;

        const completed = await this.finalizeUpload({
          execution,
          upload,
          asset: finalized.asset,
          resource: finalized.resource,
        }).unwrap();

        // Finalize has committed the resource. Cleanup is best effort: a queue that cannot take
        // the job must not turn a successful upload into an error. The upload bucket can still
        // carry its own lifecycle rule for a deployment that runs no queue.
        await this.scheduleUploadPurge(ctx, upload).discard();

        return { resource: finalized.resource, upload: completed };
      } catch (error) {
        if (mutexAcquired) {
          // Only a claim this attempt holds is ours to hand back; a finalize that lost the claim
          // must not release the one the winner is working with.
          await this.releaseUpload(upload).unwrap();
        }

        if (created) {
          // The resource was committed before the completion failed, so it is removed rather than
          // left behind as a row nothing points at. The original failure is what the caller needs.
          // Attempt deletion, but not required as-is (just a sanity/cleanup step) ~vz
          await this.context.resourceRepo.delete([created.id]).catch(() => undefined);
        }

        throw error;
      }
    });
  }

  /** Queues removal of the upload bucket object once the resource is committed. */
  private scheduleUploadPurge(ctx: TCtx, upload: UploadSession) {
    return this.prepare(async () => {
      const bucket = ctx.definition.buckets[UPLOAD_BUCKET_KEY];
      const cleanup = bucket.cleanupUploads ?? DEFAULT_UPLOAD_CLEANUP_POLICY;

      if (cleanup !== UploadCleanupPolicy.DELETE_AFTER_FINALIZE) return;

      const key = await ctx.createUploadKey(upload.id);
      await ctx.jobs.enqueue("uploads.purge", { key });
    });
  }

  /**
   * Promotes the uploaded object and turns it into a resource, reporting whether the row already
   * existed. A duplicate the create matches on is returned as-is, which is the caller's cue not to
   * take it back when a later step fails.
   *
   * `promote` owns its scope and refuses to run inside one, so this happens outside the session's
   * transaction; the claim taken before it is what keeps two finalizes apart.
   */
  private createResourceFor(upload: UploadSession) {
    return this.prepareNonTransaction(async (ctx) => {
      const definition = findDefinitionResource(ctx.definition.resources, upload.kind);
      ServiceError.assertFound(definition, "Resource definition for kind not found", {
        kind: upload.kind,
      });

      const uploadKey = await ctx.createUploadKey(upload.id);
      const asset = await ctx.assetService
        .promote({
          // Only the claims and the destination: the session carries an `id`, a `status` and a
          // `key` of its own, and `promote` inserts what it is given into the asset row.
          hashAlgorithm: upload.hashAlgorithm,
          hashHex: upload.hashHex,
          mimeType: upload.mimeType,
          size: upload.size,
          uploadKey,
          destinationBucket: definition.bucket,
          destinationKey: uploadKey,
        })
        .unwrap();

      const { resource, created } = await ctx.resourceService
        .createOrResource({
          assetId: asset.id,
          kind: upload.kind,
          owner: upload.owner,
          label: null,
          fileName: upload.fileName,
          metadata: upload.metadata,
          createdAt: new Date().toISOString(),
          updatedAt: null,
        })
        .unwrap();

      return { asset, resource, reused: !created };
    });
  }

  /**
   * Resolves who the upload is for, through the resolver its contract declares. The contract is
   * erased here, so its hooks are called without restating their signature; the claims and the
   * execution were typed by the definition before they reached this service.
   */
  private resolveOwner<TKind extends InferDefinitionResourceKinds<TCtx["definition"]> & string>({
    claims,
    execution,
    kind,
    transaction,
  }: Readonly<{
    claims: UploadClaims<InferDefinitionUploadIntent<TDefinition, TKind>>;
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    kind: TKind;
    transaction: Readonly<TCtx>;
  }>) {
    return this.prepare(async (ctx): Promise<ResourceOwner> => {
      const definition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assertFound(definition, "Resource definition for kind not found", { kind });

      const ownedBy = definition.upload?.ownedBy;
      ServiceError.assertFound(ownedBy, "Resource kind cannot be uploaded", { kind });

      return ownedBy({
        claims,
        execution,
        transaction: this.hookTransaction(transaction),
      });
    });
  }

  /**
   * The transaction view a definition's hooks receive. Their contract erases it to its loosest
   * shape, while this service's own context is the definition-bound shape of the same thing.
   */
  private hookTransaction(ctx: Readonly<TCtx>): ResourceTransactionContext {
    return { ...ctx } as unknown as ResourceTransactionContext;
  }

  private deduplicateAndAuthorize({
    execution,
    upload,
    reusePolicy,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    upload: UploadSession;
    reusePolicy: UploadReusePolicy;
  }>) {
    return this.prepare(async function (ctx) {
      this.assertTransaction();

      const bucketName = findDefinitionResource(ctx.definition.resources, upload.kind)?.bucket;
      ServiceError.assertFound(bucketName, "Bucket not found for kind", { kind: upload.kind });

      const asset = await this.findReusableAsset({
        bucket: bucketName,
        hashAlgorithm: upload.hashAlgorithm,
        hashHex: upload.hashHex,
        policy: reusePolicy,
      }).unwrap();

      const candidate = await this.findReusableResource({ upload, asset }).unwrap();

      // Ensure the upload is justified and authorized for the given execution context
      await this.context.resourceService.authorizeUpload({ execution, upload, candidate }).unwrap();

      return { candidate, asset };
    });
  }

  private findReusableAsset({
    bucket,
    hashAlgorithm,
    hashHex,
    policy,
  }: AssetHash & {
    bucket: string;
    policy: UploadReusePolicy;
  }) {
    return this.prepare(async () => {
      switch (policy.type) {
        case "exact":
          return policy.asset;
        case "auto":
          return await this.context.assetService
            .findReusableDuplicate({
              bucket,
              hashAlgorithm,
              hashHex,
            })
            .unwrap();
        case "none":
          return null;
      }
    });
  }

  private findReusableResource({
    upload,
    asset,
  }: Readonly<{
    upload: UploadSession;
    asset: Asset | null;
  }>) {
    return this.prepare(async () => {
      // Additional sanity check; not necessarily needed? ~vz
      if (
        !asset ||
        asset.size !== upload.size ||
        asset.mimeType !== upload.mimeType ||
        asset.hashAlgorithm !== upload.hashAlgorithm ||
        asset.hashHex !== upload.hashHex
      ) {
        return null;
      }

      return this.context.resourceRepo.findOne({
        assetId: asset.id,
        kind: upload.kind,
        owner: upload.owner,
        metadata: upload.metadata,
      });
    });
  }

  private finalizeUpload({
    execution,
    upload,
    resource,
    asset,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    upload: UploadSession;
    resource: Resource;
    asset: Asset;
  }>) {
    return this.prepareTransaction(async function (ctx) {
      await this.unlockUpload(upload, UploadStatus.COMPLETED).unwrap();

      const resourceDefinition = findDefinitionResource(ctx.definition.resources, upload.kind);
      ServiceError.assertFound(resourceDefinition, "Resource definition for kind not found", {
        kind: upload.kind,
      });

      const completed = await ctx.uploadSessionRepo.patch(upload.id, {
        resourceId: resource.id,
      });

      await resourceDefinition.upload?.finalize?.({
        asset,
        resource,
        owner: upload.owner,
        execution,
        intent: upload.intent ?? undefined,
        transaction: this.hookTransaction(ctx),
      });

      return completed;
    });
  }

  private lockUpload(upload: UploadSession) {
    return this.prepare(async (ctx) => {
      const [claimed] = await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PENDING }, // where
        { status: UploadStatus.PROCESSING }, // patch
      );
      ServiceError.assert(claimed, "Upload session could not be locked");
      return claimed;
    });
  }

  private unlockUpload(upload: UploadSession, next: UploadStatus) {
    return this.prepare(async (ctx) => {
      const [released] = await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PROCESSING }, // where
        { status: next }, // patch
      );
      ServiceError.assert(released, "Upload session could not be unlocked");
      return released;
    });
  }

  /**
   * Hands a claim back without insisting on holding it. A failure inside the claiming transaction
   * rolls the claim back with it, so the session is already pending — which is not an error worth
   * masking the original failure with.
   */
  private releaseUpload(upload: UploadSession) {
    return this.prepare(async (ctx) => {
      await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PROCESSING }, // where
        { status: UploadStatus.PENDING }, // patch
      );
    });
  }
}
