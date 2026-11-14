import type { Resource, ResourceWithAsset } from "@softzweig/suitcase-core";
import type { SuitcaseInsert } from "../repository.js";
import type {
  Definition,
  InferDefinitionExecutionContext,
  InferDefinitionResourceContexts,
} from "../suitcase.js";
import { findDefinitionResource } from "../suitcase.js";
import type { AssetService, AssetServiceContext } from "./asset.service.js";
import {
  ResourceMutationAction,
  type ResourceOwnerAuthorizationPayload,
} from "./resource.authorizers.js";
import { ServiceError } from "./service.error.js";
import { SuitcaseService, type SuitcaseServiceContext } from "./service.js";

/**
 * Carries the asset service's own context, so a bound resource service can hand
 * that service a context it accepts; a sibling is only as good as the context it
 * can be rebound with.
 */
export type ResourceServiceContext<TDefinition extends Definition = Definition> =
  SuitcaseServiceContext<TDefinition> & {
    assetService: AssetService<AssetServiceContext<TDefinition>>;
  };

/**
 * Fields an update may change. Identity (`kind`, `owner`, `assetId`) stays
 * immutable: moving a row between owner definitions would bypass the owner
 * authorizer of the target kind.
 */
export type ResourceUpdate = Partial<Pick<Resource, "label" | "metadata">> & { id: string };

export class ResourceService<
  TCtx extends ResourceServiceContext = ResourceServiceContext,
> extends SuitcaseService<TCtx> {
  /**
   * Creates a new resource if it doesn't already exist, otherwise returns the existing one.
   *
   * The condition for whether a resource is considered a duplicate is based on matching
   * assetId, kind, owner, and metadata, using absolute equality.
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
    return this.transaction(async (ctx) => {
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

  update({
    execution,
    delta,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    delta: ResourceUpdate;
  }>) {
    return this.transaction(async (ctx) => {
      const oldResource = await ctx.resourceRepo.findById(delta.id);
      ServiceError.assertOrNotFound(oldResource, "Resource not found", { id: delta.id });

      const newResource = await ctx.resourceRepo.patch(delta.id, delta);

      await this.authorizeMutation({
        execution,
        event: {
          action: ResourceMutationAction.UPDATE,
          resource: oldResource,
          newResource,
          delta,
        },
      }).unwrap();

      return newResource;
    });
  }

  delete({
    execution,
    resourceId,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    resourceId: string;
  }>) {
    return this.transaction(async (ctx) => {
      const [resource] = await ctx.resourceRepo.delete([resourceId]);
      ServiceError.assertOrNotFound(resource, "Resource not found", { id: resourceId });

      await this.authorizeMutation({
        execution,
        event: {
          action: ResourceMutationAction.DELETE,
          resource,
        },
      }).unwrap();

      return resource;
    });
  }

  /**
   * _[Don't Ignore Return Value]_
   * Filters the requested resources down to the ones their kind's read authorizer allows,
   * grouping the request by kind and forwarding each kind's context.
   *
   * Fails when the resource kind is not defined or a required read context is missing.
   * **The returned value must be used to determine which resources are actually allowed.**
   *
   * @human
   */
  filterReadable({
    requested,
    execution,
    contexts,
  }: Readonly<{
    execution: InferDefinitionExecutionContext<TCtx["definition"]>;
    requested: readonly ResourceWithAsset[];
    contexts: Partial<InferDefinitionResourceContexts<TCtx["definition"]>>;
  }>) {
    return this.execute(async (ctx) => {
      const resourcesByKind = new Map<string, ResourceWithAsset[]>();
      for (const resource of requested) {
        const group = resourcesByKind.get(resource.kind) ?? [];
        resourcesByKind.set(resource.kind, group);
        group.push(resource);
      }

      const allowedIds = new Set<string>();

      for (const [kind, group] of resourcesByKind) {
        const definition = findDefinitionResource(this.context.definition.resources, kind);
        ServiceError.assertOrNotFound(
          definition,
          "Resource kind not defined. Forgot to define it in Suitcase?",
          { kind },
        );

        ServiceError.assertOrNotFound(
          !definition.read.context || Boolean(contexts[kind]),
          "Resource kind requires read-context for read authorization",
          { kind },
        );

        const allowed = await definition.read.authorize({
          execution,
          requested: group,
          context: contexts[kind] as unknown as Readonly<unknown>,
          transaction: Object.freeze({
            ...ctx,
            resourceService: this as unknown as ResourceService,
          }),
        });

        if (allowed === true) {
          // `true` literally allows every requested resource of this kind
          for (const resource of group) {
            allowedIds.add(resource.id);
          }
          continue;
        }

        if (!Array.isArray(allowed)) {
          continue;
        }

        for (const entry of allowed) {
          allowedIds.add(typeof entry === "string" ? entry : entry.id);
        }
      }

      // Preserve the caller's order, but only with the ids an authorizer named.
      return requested.filter(({ id }) => allowedIds.has(id));
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
    event: ResourceOwnerAuthorizationPayload;
  }>) {
    return this.execute(async function (ctx) {
      const owner = findDefinitionResource(
        this.context.definition.resources,
        event.resource.kind,
      )?.owner;
      ServiceError.assertOrForbidden(
        owner,
        "Resource kind has no owner. Forgot to define it in Suitcase?",
        { id: event.resource.id, kind: event.resource.kind },
      );

      // The stored owner is an open record; the definition's schema is what
      // turns it into the typed owner the authorizer receives.
      const parsedOwner = owner.schema.safeParse(event.resource.owner);
      ServiceError.assertOrForbidden(
        parsedOwner.success,
        "Resource owner does not match the kind's owner schema",
        { id: event.resource.id, kind: event.resource.kind },
      );

      const authResult = await owner.authorize({
        ...event,
        execution,
        owner: parsedOwner.data,
        transaction: Object.freeze({
          ...ctx,
          resourceService: this as unknown as ResourceService,
        }),
      });

      const fullMessage =
        typeof authResult === "string" && authResult.length > 0
          ? `Action not permitted: ${authResult}`
          : "Action not permitted (authorization failed)";

      ServiceError.assertOrForbidden(authResult === true, fullMessage, {
        id: event.resource.id,
        kind: event.resource.kind,
      });
    });
  }
}
