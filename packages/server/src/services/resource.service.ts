import type { Resource } from "@softzweig/suitcase-core";
import type { SuitcaseInsert } from "../repository.js";
import type { Definition } from "../suitcase.js";
import type { AssetService, AssetServiceContext } from "./asset.service.js";
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
}
