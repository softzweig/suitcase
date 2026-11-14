import type { Resource, ResourceWithAsset } from "@softzweig/suitcase-core";
import type { ResourceServiceContext } from "./resource.service.js";

type OrAsPromise<T> = T | Promise<T>;

/**
 * Represents the result of a resource read operation, which can be an array of resource IDs
 * or resource objects, or null, undefined, or a boolean indicating the read status.
 */
export type ResourceReadAuthorization = OrAsPromise<
  (string | Pick<Resource, "id">)[] | null | undefined | boolean
>;

/**
 * The action-specific part of an owner authorization: a mutation may only
 * inspect what it acts on. Uploads see the resource about to be created,
 * updates see both sides of the patch, deletes see the row that goes away.
 */
export type ResourceOwnerAuthorizationPayload = {
  resource: Resource;
} & (
  | { action: typeof ResourceMutationAction.DELETE }
  | { action: typeof ResourceMutationAction.UPLOAD }
  | {
      action: typeof ResourceMutationAction.UPDATE;
      newResource: Resource;
      delta?: Partial<Resource>;
    }
);

export type ResourceOwnerAuthorizerArgs<
  TOwner,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<ResourceOwnerAuthorizationPayload> &
  Readonly<{
    owner: TOwner;
    execution: Readonly<TServerContext>;
    transaction: Readonly<TAppContext>;
  }>;

export type ResourceReadAuthorizerArgs<
  TReadContext,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<{
  context: Readonly<TReadContext>;
  execution: Readonly<TServerContext>;
  transaction: Readonly<TAppContext>;
  requested: readonly Readonly<ResourceWithAsset>[];
}>;

/** @see {@link ResourceReadAuthorization} */
export type ResourceReadAuthorizer<
  TReadContext,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (
  args: ResourceReadAuthorizerArgs<TReadContext, TServerContext, TAppContext>,
) => ResourceReadAuthorization;

export type ResourceOwnerAuthorizer<
  TOwner,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (
  args: ResourceOwnerAuthorizerArgs<TOwner, TServerContext, TAppContext>,
) => OrAsPromise<boolean | undefined | null | string>;

export type ResourceMutationAction =
  (typeof ResourceMutationAction)[keyof typeof ResourceMutationAction];

export const ResourceMutationAction = Object.freeze({
  UPLOAD: "upload",
  UPDATE: "update",
  DELETE: "delete",
});
