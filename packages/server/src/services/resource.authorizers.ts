import type { Resource, ResourceWithAsset, UploadSession } from "@softzweig/suitcase-core";
import type { ResourceServiceContext } from "./resource.service.js";
import type { AuthorizationVerdict } from "./service.error.js";

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
 *
 * Usage acts on the owner alone, so it carries nothing and the owner is the
 * whole subject.
 */
export type ResourceOwnerAuthorizationPayload =
  | {
      action: typeof ResourceAction.DELETE;
      resource: Resource;
    }
  | {
      action: typeof ResourceAction.UPLOAD;
      upload: UploadSession;
      /** If provided, this is the resource that is going to be reused */
      candidate: Resource | null;
    }
  | {
      action: typeof ResourceAction.UPDATE;
      resource: Resource;
      newResource: Resource;
      delta?: Partial<Resource>;
    }
  | { action: typeof ResourceAction.USAGE };

/** The payloads that act on an existing resource, so the owner can be read off it. */
export type ResourceMutationPayload = Exclude<
  ResourceOwnerAuthorizationPayload,
  { action: typeof ResourceAction.UPLOAD } | { action: typeof ResourceAction.USAGE }
>;

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

/** The claim a caller submitted, already validated against the kind's schema. */
export type ResourceVerifyArgs<
  TClaim,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<{
  claim: TClaim;
  execution: Readonly<TServerContext>;
  transaction: Readonly<TAppContext>;
}>;

/**
 * Turns the caller's claim into the scope the read may work from.
 *
 * Whatever this returns is what `expose` receives, so a read cannot accidentally work from the
 * unverified claim. Refuse a claim the caller may not make by throwing; the read then fails
 * instead of exposing anything.
 */
export type ResourceVerifyClaim<
  TClaim,
  TScope,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (args: ResourceVerifyArgs<TClaim, TServerContext, TAppContext>) => OrAsPromise<TScope>;

export type ResourceExposeArgs<
  TScope,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = Readonly<{
  /** What {@link ResourceVerifyClaim} produced; `undefined` for a read without a claim. */
  scope: TScope;
  execution: Readonly<TServerContext>;
  transaction: Readonly<TAppContext>;
  requested: readonly Readonly<ResourceWithAsset>[];
}>;

/**
 * Decides what a read may hand out: everything requested, a subset of it, or nothing.
 *
 * @see {@link ResourceReadAuthorization}
 */
export type ResourceExpose<TScope, TServerContext, TAppContext extends ResourceServiceContext> = (
  args: ResourceExposeArgs<TScope, TServerContext, TAppContext>,
) => ResourceReadAuthorization;

export type ResourceOwnerAuthorizer<
  TOwner,
  TServerContext,
  TAppContext extends ResourceServiceContext,
> = (
  args: ResourceOwnerAuthorizerArgs<TOwner, TServerContext, TAppContext>,
) => OrAsPromise<AuthorizationVerdict>;

export type ResourceAction = (typeof ResourceAction)[keyof typeof ResourceAction];

/**
 * What an owner authorizer is asked about: a mutation judging the row it acts on, or `usage`, a
 * read of what the owner holds. Only `true` permits either.
 */
export const ResourceAction = Object.freeze({
  UPLOAD: "upload",
  UPDATE: "update",
  DELETE: "delete",
  USAGE: "usage",
});
