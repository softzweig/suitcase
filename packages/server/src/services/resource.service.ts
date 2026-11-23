import type { Resource, ResourceWithAsset, UploadSession } from "@softzweig/suitcase-core";
import type {
  ResourceDeleteRequest,
  ResourceDownload,
  ResourceResolveRequest,
} from "@softzweig/suitcase-core/contracts";
import type { SuitcaseInsert } from "../repository.js";
import type {
  Definition,
  InferDefinitionExecutionContext,
  InferDefinitionResourceClaims,
  SchemaOutput,
} from "../suitcase.js";
import { findDefinitionResource } from "../suitcase.js";
import type { AssetService, AssetServiceContext } from "./asset.service.js";
import {
  type ResourceExpose,
  ResourceMutationAction,
  type ResourceMutationPayload,
  type ResourceOwnerAuthorizationPayload,
  type ResourceVerifyClaim,
} from "./resource.authorizers.js";
import { ServiceError } from "./service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "./service.js";
import { toServiceFailure } from "./service.result.js";

/**
 * Carries the asset service's own context, so a bound resource service can hand
 * that service a context it accepts; a sibling is only as good as the context it
 * can be rebound with.
 */
export type ResourceServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition> & {
    assetService: AssetService<AssetServiceContext<TDefinition>>;
    /** The maximum number of resources that can be resolved in a single operation. @default 100 */
    createResolverLimit?: (execution: InferDefinitionExecutionContext<TDefinition>) => number;
    /** The expiration time for (signed) download URLs from resources, in seconds. @default 3600 */
    createExpirationInSeconds?: (execution: InferDefinitionExecutionContext<TDefinition>) => number;
  };

/**
 * Fields an update may change. Identity (`kind`, `owner`, `assetId`) stays
 * immutable: moving a row between owner definitions would bypass the owner
 * authorizer of the target kind.
 */
export type ResourceUpdate = Partial<Pick<Resource, "label" | "metadata">> & { id: string };

/** What an update carries, apart from the execution it runs on. */
export type ResourceUpdateInput = Readonly<{ delta: ResourceUpdate }>;

export class ResourceService<
  TDefinition extends Definition = Definition,
  TCtx extends ResourceServiceContext<TDefinition> = ResourceServiceContext<TDefinition>,
> extends SuitcaseService<TCtx> {
  static readonly DEFAULT_DOWNLOAD_EXPIRATION_SECONDS = 3600; // Example: 1 hour expiration
  static readonly DEFAULT_RESOLVE_LIMIT = 100; // Example: default resolve limit

  /**
   * Creates a new resource if it doesn't already exist, otherwise returns the existing one.
   *
   * The condition for whether a resource is considered a duplicate is based on matching
   * `assetId`, `kind`, `owner`, and `metadata`, using **absolute** equality.
   *
   * @important
   * The caller must already be authorized for `owner` and `assetId`, which is the
   * upload flow's job: a repeat request returns the existing row in full.
   *
   * @reasoning
   * The reasoning behind the condition is to prevent duplicate resources from being created
   * when the assetId, kind, owner, and metadata are identical, ensuring data consistency and
   * avoiding unnecessary storage usage. `kind` is part of the identity because the same asset
   * may back differently-authorized representations of it.
   *
   * @human
   */
  createOrResource(data: SuitcaseInsert<Resource>) {
    return this.transactional(async function (ctx) {
      const definition = findDefinitionResource(this.context.definition.resources, data.kind);
      ServiceError.assertOrInvalidInput(
        definition,
        "Resource kind not defined. Forgot to define it in Suitcase?",
        { kind: data.kind },
      );

      // The owner is the key every later authorization uses, so it has to satisfy the kind's
      // schema before the row exists. Whether this caller may point the resource at that asset
      // is a separate question, answered by the upload authorization.
      ServiceError.assertOrInvalidInput(
        definition.owner.schema.safeParse(data.owner).success,
        "Resource owner does not match the kind's owner schema",
        { kind: data.kind },
      );

      const duplicateResource = await ctx.resourceRepo.findOne({
        assetId: data.assetId,
        kind: data.kind,
        owner: data.owner,
        metadata: data.metadata,
      });

      if (duplicateResource) {
        return {
          created: false,
          resource: duplicateResource,
        } as const;
      }

      return {
        created: true,
        resource: await ctx.resourceRepo.insert(data),
      } as const;
    });
  }

  /**
   * Updates a resource by applying the specified delta within a transaction and ensures
   * authorization of the update afterwards, causing a rollback, if authorization fails.
   *
   * @see {@link authorizeMutation}
   * @human
   */
  update({
    execution,
    delta,
  }: ResourceUpdateInput & {
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
  }) {
    return this.transactional(async function (ctx) {
      const oldResource = await ctx.resourceRepo.findById(delta.id);
      ServiceError.assertOrNotFound(oldResource, "Resource not found", { id: delta.id });

      // Only the mutable fields reach the repository. The identity columns are what the owner
      // authorizer is keyed on, and a caller without these types (a transport handler) could
      // otherwise rewrite `kind`, `owner` or `assetId` through an untyped delta.
      const patch = {
        ...(delta.label !== undefined && { label: delta.label }),
        ...(delta.metadata !== undefined && { metadata: delta.metadata }),
      };

      const newResource = await ctx.resourceRepo.patch(delta.id, patch);

      await this.authorizeMutation({
        execution,
        event: {
          action: ResourceMutationAction.UPDATE,
          resource: oldResource,
          newResource,
          delta: patch,
        },
      }).unwrap();

      return newResource;
    });
  }

  /**
   * Deletes a resource by its ID within a transaction and ensures authorization of the
   * deletion afterwards, causing a rollback, if authorization fails.
   *
   * The asset behind the row is not deleted with it: it is marked once the row is gone, has no
   * resources left pointing at it, and its bytes are purged out of band through the job the mark
   * queues.
   *
   * @see {@link authorizeMutation}
   * @human
   */
  delete({
    execution,
    resourceId,
  }: ResourceDeleteRequest & {
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
  }) {
    return this.execute(async function (ctx) {
      const resource = await this.transaction(async function (ctx) {
        const [deleted] = await ctx.resourceRepo.delete([resourceId]);
        ServiceError.assertOrNotFound(deleted, "Resource not found", { id: resourceId });

        await this.authorizeMutation({
          execution,
          event: {
            action: ResourceMutationAction.DELETE,
            resource: deleted,
          },
        }).unwrap();

        return deleted;
      });

      // Marked after the commit, not inside it: the asset service queues the purge as part of the
      // mark, and the job has to see it. `delete` is also what the reference check should see,
      // which is the row being gone for good rather than gone in this transaction.
      await ctx.assetService.markDeleted({ assetId: resource.assetId }).unwrap();

      return resource;
    });
  }

  /**
   * Resolves the requested resources into a download list, one entry per requested ID.
   *
   * Every entry reports its own status: `ok` carries the resource's naming plus its link, `error`
   * carries the failure category, so a caller can render the list as it is. Ids that do not exist
   * and ids the caller may not read both report `NOT_FOUND`, because telling them apart would
   * reveal resources the caller cannot read.
   *
   * The call itself fails only when the request exceeds `resolveLimit`, or when the definition
   * cannot answer for a kind at all (through {@link listReadable}), which is configuration rather
   * than a per-resource outcome.
   *
   * @human
   */
  resolve({
    execution,
    requestedIds,
    claims,
  }: ResourceResolveRequest<Partial<InferDefinitionResourceClaims<TCtx["definition"]>>> & {
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
  }) {
    return this.nontransactional(async function (ctx) {
      const resolveLimit =
        ctx.createResolverLimit?.(execution) ?? ResourceService.DEFAULT_RESOLVE_LIMIT;

      ServiceError.assertOrInvalidInput(
        requestedIds.length <= resolveLimit,
        `Cannot resolve more than ${resolveLimit} resources at once.`,
        { actual: requestedIds.length, limit: resolveLimit },
      );

      const readable = await this.listReadable({ execution, requestedIds, claims }).unwrap();
      const byId = new Map(readable.map((resource) => [resource.id, resource]));

      const expirationInSeconds =
        this.context.createExpirationInSeconds?.(execution) ??
        ResourceService.DEFAULT_DOWNLOAD_EXPIRATION_SECONDS;

      // Requested order, deduplicated, so the caller gets each id it asked for exactly once.
      return Promise.all(
        [...new Set(requestedIds)].map(async (resourceId): Promise<ResourceDownload> => {
          try {
            const resource = byId.get(resourceId);
            ServiceError.assertOrNotFound(resource, "Resource not found");

            const url = await ctx.assetService
              .createDownloadUrl({
                asset: resource.asset,
                expiresInSeconds: expirationInSeconds,
              })
              .unwrap();

            return {
              ok: true,
              id: resourceId,
              label: resource.label,
              fileName: resource.fileName,
              url,
            };
          } catch (error) {
            return {
              ok: false,
              id: resourceId,
              code: toServiceFailure(error).code,
            };
          }
        }),
      );
    });
  }

  /**
   * Returns the list of resources that are readable by the current execution context.
   *
   * This essentially wraps {@link filterReadable} and returns only the resources that are
   * allowed by the read authorizer, based on a given set of IDs instead of authoritative
   * resource entities.
   *
   * @important Note that this returning value contains the asset metadata themselves, meaning
   * this should not be user-facing directly, but instead used by consumer code.
   *
   * @human
   */
  listReadable({
    execution,
    requestedIds,
    claims,
  }: ResourceResolveRequest<Partial<InferDefinitionResourceClaims<TCtx["definition"]>>> & {
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
  }) {
    // A function, not an arrow: `transactional` rebinds `this` to the service bound to the
    // transaction, and the asset join below has to read through that same handle.
    return this.transactional(async function (ctx) {
      const resources = await ctx.resourceRepo.findByIds(requestedIds);
      const requested = await this.innerJoinOnAssets(resources).unwrap();
      return this.filterReadable({ execution, claims, requested }).unwrap();
    });
  }

  /**
   * Filters the requested resources down to the ones their kind's read authorizer allows,
   * grouping the request by kind and forwarding each kind's context.
   *
   * Fails when the resource kind is not defined or a required read context is missing.
   * **The returned value must be used to determine which resources are actually allowed.**
   *
   * @important Note that this returning value contains the asset metadata themselves, meaning
   * this should not be user-facing directly, but instead used by consumer code.
   *
   * @human
   */
  filterReadable({
    requested,
    execution,
    claims,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    requested: readonly ResourceWithAsset[];
    claims: Partial<InferDefinitionResourceClaims<TCtx["definition"]>>;
  }>) {
    return this.execute(async function (ctx) {
      const resourcesByKind = new Map<string, ResourceWithAsset[]>();
      for (const resource of requested) {
        const group = resourcesByKind.get(resource.kind) ?? [];
        resourcesByKind.set(resource.kind, group);
        group.push(resource);
      }

      // Collected per kind: an authorizer vouches only for its own kind's resources, so a
      // query that happens to return another kind's id cannot grant it.
      const readable = new Set<ResourceWithAsset>();

      for (const [kind, group] of resourcesByKind) {
        const definition = findDefinitionResource(this.context.definition.resources, kind);
        ServiceError.assertOrNotFound(
          definition,
          "Resource kind not defined. Forgot to define it in Suitcase?",
          { kind },
        );

        const read = definition.read;

        // `claims` is keyed by the local name and typed per kind on the consumer's
        // definition, so the lookup goes through the loosest shape it shares.
        const suppliedClaim = read.claim ? (claims as Record<string, unknown>)[kind] : undefined;

        ServiceError.assertOrNotFound(
          !read.claim || suppliedClaim !== undefined,
          "Resource kind requires a claim for read authorization",
          { kind },
        );

        // The claim is what the caller says about the request, so the kind's schema is what
        // makes it checkable; it is parsed rather than trusted.
        const parsedClaim = read.claim?.safeParse(suppliedClaim);
        ServiceError.assertOrInvalidInput(
          !parsedClaim || parsedClaim.success,
          "Resource claim does not match the kind's schema",
          { kind },
        );

        // The authorizer arg types are definition-agnostic, so the definition-bound context is
        // passed as the erased shape they declare.
        const transaction = Object.freeze({
          ...ctx,
          resourceService: this as unknown as ResourceService,
        }) as unknown as ResourceServiceContext;

        // The definition erases each kind's claim and scope types, so the hooks are viewed at
        // their loosest shape here; the values handed over were validated just above.
        const verify = read.verify as
          | ResourceVerifyClaim<unknown, unknown, unknown, ResourceServiceContext>
          | undefined;
        const expose = read.expose as ResourceExpose<unknown, unknown, ResourceServiceContext>;

        // What the caller claimed becomes a scope only by passing `verify`; `expose` never
        // sees the claim itself, so it cannot work from something unverified.
        const scope = verify
          ? await verify({
              claim: parsedClaim?.success ? parsedClaim.data : undefined,
              execution,
              transaction,
            })
          : undefined;

        const allowed = await expose({
          execution,
          requested: group,
          scope,
          transaction,
        });

        if (allowed === true) {
          for (const resource of group) {
            readable.add(resource);
          }
          continue;
        }

        if (!Array.isArray(allowed)) {
          continue;
        }

        const allowedIds = new Set(
          allowed.map((entry) => (typeof entry === "string" ? entry : entry.id)),
        );

        for (const resource of group) {
          if (allowedIds.has(resource.id)) {
            readable.add(resource);
          }
        }
      }

      // Preserve the caller's order, but only with what an authorizer allowed.
      return requested.filter((resource) => readable.has(resource));
    });
  }

  /**
   * Authorizes a mutation on a resource by consulting the resource's owner authorizer.
   *
   * Throws a forbidden error if the owner authorizer denies the mutation, nothing needs
   * to be returned by this method, as its primary purpose is to enforce authorization.
   *
   * @human
   */
  authorizeMutation({
    execution,
    event,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    event: ResourceMutationPayload;
  }>) {
    const { resource } = event;

    return this.authorizeOwner({
      event,
      execution,
      id: resource.id,
      kind: resource.kind,
      owner: resource.owner,
    });
  }

  /**
   * Authorizes starting an upload. The resource it may become does not exist yet, so the owner
   * and kind the session recorded are what the owner authorizer decides on.
   */
  authorizeUpload({
    execution,
    upload,
    candidate,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    upload: UploadSession;
    /** If given, the `Resource` that is going to be reused for this upload */
    candidate: Resource | null;
  }>) {
    return this.authorizeOwner({
      event: {
        action: ResourceMutationAction.UPLOAD,
        upload,
        candidate,
      },
      execution,
      id: upload.id,
      kind: upload.kind,
      owner: upload.owner,
    });
  }

  /**
   * The owner decision itself: every mutation supplies the kind and owner it acts on, and this
   * resolves the definition, parses the stored owner through its schema and asks it.
   */
  private authorizeOwner({
    event,
    execution,
    id,
    kind,
    owner,
  }: Readonly<{
    event: ResourceOwnerAuthorizationPayload;
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    id: string;
    kind: string;
    owner: unknown;
  }>) {
    return this.execute(async function (ctx) {
      const definition = findDefinitionResource(this.context.definition.resources, kind)?.owner;
      ServiceError.assertOrForbidden(
        definition,
        "Resource kind has no owner. Forgot to define it in Suitcase?",
        { id, kind },
      );

      // The stored owner is an open record; the definition's schema is what
      // turns it into the typed owner the authorizer receives.
      const parsedOwner = definition.schema.safeParse(owner);
      ServiceError.assertOrForbidden(
        parsedOwner.success,
        "Resource owner does not match the kind's owner schema",
        { id, kind },
      );

      const authResult = await definition.authorize({
        ...event,
        execution,
        owner: parsedOwner.data as SchemaOutput<typeof definition.schema>,
        transaction: Object.freeze({
          ...ctx,
          resourceService: this as unknown as ResourceService,
        }) as unknown as ResourceServiceContext & { resourceService: ResourceService },
      });

      ServiceError.assertPermitted(authResult, { id, kind });
    });
  }

  /** Manually joins `resources` with their corresponding assets (NO AUTO TRANSACTION) */
  protected innerJoinOnAssets(resources: Resource[]) {
    return this.execute(async (ctx) => {
      const assets = await ctx.assetRepo.findByIds([...new Set(resources.map((r) => r.assetId))]);
      return resources
        .map((resource) => ({
          ...resource,
          asset: assets.find((asset) => asset.id === resource.assetId) ?? null,
        }))
        .filter((resource): resource is ResourceWithAsset => resource.asset !== null);
    });
  }
}
