import {
  type Asset,
  type AssetHash,
  type Resource,
  type ResourceOwner,
  type UploadIntent,
  type UploadSession,
  UploadStatus,
} from "@softzweig/suitcase-core";
import { ByteSize } from "@softzweig/suitcase-core/utils";
import {
  type Definition,
  findDefinitionResource,
  type InferDefinitionExecutionContext,
  type InferDefinitionResourceKinds,
  type InferDefinitionUploadIntent,
  type InferDefinitionUploadPayload,
  type ResourceTransactionContext,
  type ResourceUploadClaims,
} from "../suitcase.js";
import type { AssetService, AssetServiceContext } from "./asset.service.js";
import type { ResourceService } from "./resource.service.js";
import { ServiceError } from "./service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "./service.js";

export type UploadReusePolicy =
  | { type: "exact"; asset: Asset }
  | { type: "auto" }
  | { type: "none" };

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
  };

export class UploadService<
  TDefinition extends Definition = Definition,
  TCtx extends UploadServiceContext<TDefinition> = UploadServiceContext<TDefinition>,
> extends SuitcaseService<TCtx> {
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
    claims: ResourceUploadClaims<UploadIntent | InferDefinitionUploadIntent<TDefinition, TKind>>;
    owner: ResourceOwner;
  }>) {
    return this.execute(async (ctx) => {
      const resourceDefinition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assertOrNotFound(resourceDefinition, "Resource definition not found", { kind });

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

      ServiceError.assertPrecondition(
        !intentSchema || intentSchema.safeParse(claims.intent).success,
        "Invalid upload intent, or outdated (app-update, potentially retry)",
        { kind, claims },
      );

      const acceptFn = resourceDefinition.upload?.accept;

      if (acceptFn) {
        const verdict = await acceptFn({ claims, execution, owner, transaction });
        ServiceError.assertPermitted(verdict, { kind, claims });
      }

      ServiceError.assertPrecondition(
        !criteria.maxSize || criteria.maxSize.gte(claims.size),
        "Upload exceeds maximum size",
        { kind, claims, maxSize: criteria.maxSize?.format() },
      );

      ServiceError.assertPrecondition(
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
   * @human
   */
  initialize<TKind extends InferDefinitionResourceKinds<TCtx["definition"]> & string>({
    kind,
    execution,
    expiresInSeconds = 3600,
    claims,
    payload,
    reusePolicy,
  }: Readonly<{
    kind: TKind;
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    claims: ResourceUploadClaims<InferDefinitionUploadIntent<TDefinition, TKind>>;
    payload: InferDefinitionUploadPayload<TCtx["definition"], TKind>;
    expiresInSeconds?: number;
    reusePolicy: UploadReusePolicy;
  }>) {
    return this.nontransactional(async function (ctx) {
      const dateNow = new Date();
      const expiresAt = new Date(dateNow.getTime() + expiresInSeconds * 1000);

      const owner = await this.resolveOwner({
        claims,
        execution,
        kind,
        payload,
        transaction: ctx,
      }).unwrap();

      // Verify the claims against potential upload constraints defined for the resource
      await this.verifyUploadConstraints({
        claims,
        execution,
        owner,
        kind,
      }).unwrap();

      const dedupe = await this.transaction(async function (ctx) {
        const upload = await ctx.uploadSessionRepo.insert({
          ...claims,
          intent: claims.intent ?? null,
          metadata: claims.metadata ?? null,
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
        const presignedUrl = await ctx.assetService
          .createUploadUrl({ ...claims, expiresInSeconds, uploadKey })
          .unwrap();

        return {
          upload: dedupe.upload,
          reused: false,
          presignedUrl,
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
    reusePolicy,
    uploadId,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    reusePolicy: UploadReusePolicy;
    uploadId: string;
  }>) {
    return this.nontransactional(async function (ctx) {
      const upload = await ctx.uploadSessionRepo.findById(uploadId);
      ServiceError.assertOrNotFound(upload, "Upload session not found", { uploadId });

      ServiceError.assertPrecondition(
        Date.parse(upload.expiresAt) > Date.now(),
        "Upload session has expired",
        { uploadId },
      );

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
      let claimed = false;
      let created: Resource | null = null;

      try {
        const dedupe = await this.transaction(async function () {
          await this.lockUpload(upload).unwrap();
          claimed = true;
          return this.deduplicateAndAuthorize({ execution, upload, reusePolicy }).unwrap();
        });

        // Reuse what the authorization approved, or else promote the bytes and create a resource of
        // their own. Either way this is the only authorization of the upload.
        const finalized =
          dedupe.candidate && dedupe.asset
            ? { asset: dedupe.asset, resource: dedupe.candidate }
            : await this.createResourceFor(upload).unwrap();

        // Only a resource this attempt created is ours to take back; a reused one belongs to
        // whoever created it first, thus only a newly created resource is considered "ours"
        created = finalized.resource.id !== dedupe.candidate?.id ? finalized.resource : null;

        await this.finalizeUpload({
          execution,
          upload,
          asset: finalized.asset,
          resource: finalized.resource,
        }).unwrap();
      } catch (error) {
        // Only a claim this attempt holds is ours to hand back; a finalize that lost the claim
        // must not release the one the winner is working with.
        if (claimed) await this.releaseUpload(upload).unwrap();

        if (!created) throw error;

        // The resource was committed before the completion failed, so it is removed rather than
        // left behind as a row nothing points at. The original failure is what the caller needs.
        // Attempt deletion, but not required as-is (just a sanity/cleanup step) ~vz
        await this.context.resourceRepo.delete([created.id]).catch(() => undefined);
        throw error;
      }
    });
  }

  /**
   * Promotes the uploaded object and turns it into a resource.
   *
   * `promote` owns its scope and refuses to run inside one, so this happens outside the session's
   * transaction; the claim taken before it is what keeps two finalizes apart.
   */
  private createResourceFor(upload: UploadSession) {
    return this.nontransactional(async (ctx) => {
      const definition = findDefinitionResource(ctx.definition.resources, upload.kind);
      ServiceError.assertOrNotFound(definition, "Resource definition for kind not found", {
        kind: upload.kind,
      });

      const uploadKey = await ctx.createUploadKey(upload.id);
      const asset = await ctx.assetService
        .promote({
          ...upload,
          uploadKey,
          destinationBucket: definition.bucket,
          destinationKey: uploadKey,
        })
        .unwrap();

      const { resource } = await ctx.resourceService
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

      return { asset, resource };
    });
  }

  /**
   * Resolves who the upload is for: the kind's payload, through the resolver its contract declares.
   * The contract is erased here, so its hooks are called without restating their signature; the
   * payload was typed by the definition before it reached this service.
   */
  private resolveOwner<TKind extends InferDefinitionResourceKinds<TCtx["definition"]> & string>({
    claims,
    execution,
    kind,
    payload,
    transaction,
  }: Readonly<{
    claims: ResourceUploadClaims<InferDefinitionUploadIntent<TDefinition, TKind>>;
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    kind: TKind;
    payload: InferDefinitionUploadPayload<TCtx["definition"], TKind>;
    transaction: Readonly<TCtx>;
  }>) {
    return this.execute(async (ctx): Promise<ResourceOwner> => {
      const definition = findDefinitionResource(ctx.definition.resources, kind);
      ServiceError.assertOrNotFound(definition, "Resource definition for kind not found", { kind });

      const ownedBy = definition.upload?.ownedBy;
      ServiceError.assertOrNotFound(ownedBy, "Resource kind cannot be uploaded", { kind });

      return ownedBy({
        claims,
        payload,
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
    return this.execute(async function (ctx) {
      this.assertTransaction();

      const bucketName = findDefinitionResource(ctx.definition.resources, upload.kind)?.bucket;
      ServiceError.assertOrNotFound(bucketName, "Bucket not found for kind", { kind: upload.kind });

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
    return this.execute(async () => {
      switch (policy.type) {
        case "exact":
          return policy.asset;
        case "auto":
          return this.context.assetService.findDuplicate({ bucket, hashAlgorithm, hashHex });
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
    return this.execute(async () => {
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
    return this.transactional(async function (ctx) {
      await this.unlockUpload(upload, UploadStatus.COMPLETED).unwrap();

      const resourceDefinition = findDefinitionResource(ctx.definition.resources, upload.kind);
      ServiceError.assertOrNotFound(resourceDefinition, "Resource definition for kind not found", {
        kind: upload.kind,
      });

      await ctx.uploadSessionRepo.patch(upload.id, {
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
    });
  }

  private lockUpload(upload: UploadSession) {
    return this.execute(async (ctx) => {
      const [claimed] = await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PENDING }, // where
        { status: UploadStatus.PROCESSING }, // patch
      );
      ServiceError.assertPrecondition(claimed, "Upload session could not be locked");
      return claimed;
    });
  }

  private unlockUpload(upload: UploadSession, next: UploadStatus) {
    return this.execute(async (ctx) => {
      const [released] = await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PROCESSING }, // where
        { status: next }, // patch
      );
      ServiceError.assertPrecondition(released, "Upload session could not be unlocked");
      return released;
    });
  }

  /**
   * Hands a claim back without insisting on holding it. A failure inside the claiming transaction
   * rolls the claim back with it, so the session is already pending — which is not an error worth
   * masking the original failure with.
   */
  private releaseUpload(upload: UploadSession) {
    return this.execute(async (ctx) => {
      await ctx.uploadSessionRepo.patchWhere(
        { id: upload.id, status: UploadStatus.PROCESSING }, // where
        { status: UploadStatus.PENDING }, // patch
      );
    });
  }
}
