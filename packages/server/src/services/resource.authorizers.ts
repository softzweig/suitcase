import type { Asset, Resource } from "@softzweig/suitcase-core";
import type { ResourceServiceContext } from "./resource.service.js";

type OrAsPromise<T> = T | Promise<T>;

/**
 * Represents the result of a resource read operation, which can be an array of resource IDs
 * or resource objects, or null, undefined, or a boolean indicating the read status.
 */
export type ResourceReadAuthorization = OrAsPromise<
  (string | Pick<Resource, "id">)[] | null | undefined | boolean
>;

export type ResourceOwnerAuthorizerArgs<
  TOwnerKey extends string,
  TOwner,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<{
  /** The supplied key within the definition mapping */
  key: TOwnerKey;
  owner: Readonly<TOwner>;
  action: ResourceMutationAction;
  execution: Readonly<TServerContext>;
  transaction: Readonly<TAppContext>;
}>;

export type ResourceReadAuthorizerArgs<
  TReadKey extends string,
  TReadContext,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<{
  /** The supplied key within the definition mapping */
  key: TReadKey;
  context: Readonly<TReadContext>;
  action: ResourceMutationAction;
  execution: Readonly<TServerContext>;
  transaction: Readonly<TAppContext>;
  requested: ReadonlyArray<Readonly<Resource & { asset: Asset }>>;
}>;

/** @see {@link ResourceReadAuthorization} */
export type ResourceReadAuthorizer<
  TType extends string,
  TReadContext,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (
  args: ResourceReadAuthorizerArgs<TType, TReadContext, TServerContext, TAppContext>,
) => ResourceReadAuthorization;

export type ResourceOwnerAuthorizer<
  TKey extends string,
  TOwner,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (
  args: ResourceOwnerAuthorizerArgs<TKey, TOwner, TServerContext, TAppContext>,
) => OrAsPromise<boolean | undefined | null>;

export type ResourceMutationAction =
  (typeof ResourceMutationAction)[keyof typeof ResourceMutationAction];

export const ResourceMutationAction = Object.freeze({
  UPLOAD: "upload",
  UPDATE: "update",
  DELETE: "delete",
});
