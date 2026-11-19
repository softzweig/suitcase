import type { Asset, Resource } from "@softzweig/suitcase-core";
import type { UploadClaims } from "@softzweig/suitcase-core/contracts";
import type { ByteSizeOperand } from "@softzweig/suitcase-core/utils";
import type z from "zod";
import type {
  ResourceExpose,
  ResourceOwnerAuthorizer,
  ResourceReadAuthorization,
  ResourceVerifyClaim,
} from "./services/resource.authorizers.js";
import type { ResourceService, ResourceServiceContext } from "./services/resource.service.js";
import type { AuthorizationVerdict } from "./services/service.error.js";
import type { SuitcaseBuckets, UPLOAD_BUCKET_KEY } from "./storage/storage.buckets.js";

export type ResourceTransactionContext = ResourceServiceContext & {
  resourceService: ResourceService;
};

/**
 * What a schema parses to, or `never` when the schema is the erased `z.ZodType`: contravariance
 * makes every implementation accept `never`, while the inferred `unknown` would be accepted by none.
 */
export type SchemaOutput<TSchema extends z.ZodType> = z.ZodType extends TSchema
  ? never
  : z.infer<TSchema>;

/**
 * What a kind's intent schema parses to, or `undefined` when the kind declares none: no intent
 * means nothing beyond the owner payload is asked of the client.
 */
export type UploadIntentOf<TIntent extends z.ZodType | undefined> = TIntent extends z.ZodType
  ? z.infer<TIntent>
  : undefined;

/**
 * The bucket names a definition registered, read off the context its authorizers receive: a
 * resource may only name a bucket the definition actually declared.
 */
export type BucketNameOf<TContext> = TContext extends { readonly buckets: infer TBuckets }
  ? Extract<keyof TBuckets, string>
  : string;

export type ResourceOwnerDefinition<
  TServerContext = never,
  TSchema extends z.ZodType = z.ZodType,
> = Readonly<{
  /** Define the owner schema, that is reused by upload target resolve logic (consumer-defined) */
  schema: TSchema;
  /** Define whether a certain mutation can be made on this owner (only `true` allows it) */
  authorize: ResourceOwnerAuthorizer<
    SchemaOutput<TSchema>,
    TServerContext,
    ResourceTransactionContext
  >;
}>;

/** A read whose exposure is decided for the whole kind; the caller submits no claim. */
export type OpenResourceRead<TServerContext = never> = Readonly<{
  expose: ResourceExpose<undefined, TServerContext, ResourceTransactionContext>;
}>;

/**
 * A read scoped by a claim the caller submits. `verify` is what makes it trustworthy: it runs
 * once per kind, may refuse, and its result is the only thing `expose` sees.
 */
export type ScopedResourceRead<
  TServerContext = never,
  TClaim extends z.ZodType = z.ZodType,
  TScope = z.infer<TClaim>,
> = Readonly<{
  /** Validated against this schema before `verify` sees it. */
  claim: TClaim;
  verify: ResourceVerifyClaim<z.infer<TClaim>, TScope, TServerContext, ResourceTransactionContext>;
  expose: ResourceExpose<TScope, TServerContext, ResourceTransactionContext>;
}>;

export type ResourceReadDefinition<
  TServerContext = never,
  TClaim extends z.ZodType = z.ZodType,
  TScope = z.infer<TClaim>,
> = OpenResourceRead<TServerContext> | ScopedResourceRead<TServerContext, TClaim, TScope>;

/**
 * The erased shape a stored definition exposes: enough to read a claim and reach the hooks
 * without knowing a kind's scope type.
 */
export type AnyResourceRead = Readonly<{
  claim?: z.ZodType;
  verify?: unknown;
  expose: (args: never) => ResourceReadAuthorization;
}>;

export type ResourceUploadArgs<
  TServerContext = never,
  TOwner = never,
  TIntent extends z.ZodType | undefined = undefined,
> = Readonly<{
  owner: TOwner;
  /** What the client sent about the file itself: content, name, metadata and intent. */
  claims: UploadClaims<UploadIntentOf<TIntent>>;
  execution: Readonly<TServerContext>;
  transaction: Readonly<ResourceTransactionContext>;
}>;

/**
 * What `finalize` receives once an upload has produced a resource: the stored asset, the resource
 * it became, and the decisions the session was started under. Read-only — the outcome is settled.
 */
export type ResourceFinalizeArgs<
  TServerContext = never,
  TOwner = never,
  TIntent extends z.ZodType | undefined = undefined,
> = Readonly<{
  /** The asset the upload stored. */
  asset: Asset;
  /** The resource that asset became. */
  resource: Resource;
  /**
   * What the client stated, when the kind declares an intent and it survived the round trip
   * through the session. Absent otherwise, so a hook never has to reconstruct it.
   */
  intent?: UploadIntentOf<TIntent>;
  /** The owner the upload was started for, typed by the kind's owner schema. */
  owner: TOwner;
  execution: Readonly<TServerContext>;
  transaction: Readonly<ResourceTransactionContext>;
}>;

/**
 * What an upload must satisfy: limits, and how its owner is decided. The owner never comes from the
 * client directly, only from what the server knows about the request through `ownedBy`.
 */
export type ResourceUpload<
  TServerContext = never,
  TOwner = never,
  TIntent extends z.ZodType | undefined = undefined,
> = Readonly<{
  /** Accepted MIME types. Omit to accept any. */
  mimeTypes?: readonly string[];
  /** Largest accepted file, in bytes. Omit for no limit. */
  maxSize?: ByteSizeOperand;
  /**
   * What the client states beyond the file itself: validated by this schema and stored on the
   * upload session, for the owner resolution and the finalizer to read. Omit it when the execution
   * context says everything.
   */
  intent?: TIntent;

  /**
   * Dynamic policy the static limits cannot express, e.g. quotas.
   * Returns an authorization verdict indicating whether the upload is acceptable.
   *
   * The accept function is called within the initialization **and** finalization phases
   * of the upload, meaning e.g. quotas are checked time-independently at both stages.
   *
   * @human
   */
  accept?: (
    args: ResourceUploadArgs<TServerContext, TOwner, TIntent>,
  ) => AuthorizationVerdict | Promise<AuthorizationVerdict>;

  /**
   * Resolves the owner the upload is for, from the execution context and what the client stated.
   * Required, because nothing else can say who a resource belongs to; the session records the
   * result once, and `finalize` never re-resolves it.
   */
  ownedBy: (args: {
    /** What the client stated about the file itself: content, name, metadata and intent. */
    claims: UploadClaims<UploadIntentOf<TIntent>>;
    execution: Readonly<TServerContext>;
    transaction: Readonly<ResourceTransactionContext>;
  }) => TOwner;

  /**
   * Runs once the upload has produced a resource. Side effects only: the asset is stored and the
   * resource exists by then, so whatever a hook returns is ignored.
   */
  finalize?: (args: ResourceFinalizeArgs<TServerContext, TOwner, TIntent>) => void | Promise<void>;
}>;

/**
 * A schema whose output is unknown, which every schema is assignable to. `z.ZodType` (defaulting to
 * `unknown`) is invariant in its internals, so a concrete object schema is not one of those.
 */
// biome-ignore lint/suspicious/noExplicitAny: erasing the intent is the point of the alias
type AnyIntentSchema = z.ZodType<any>;

/**
 * A kind's upload contract with its owner and intent erased, so any concrete contract fits it: the
 * `any` absorbs the narrower `accept` argument an intent-declaring contract has, which `unknown`
 * (and every narrower shape) would reject. This is what a definition map exposes without knowing
 * a kind.
 */
export type AnyResourceUpload<TServerContext = never> = ResourceUpload<
  TServerContext,
  // biome-ignore lint/suspicious/noExplicitAny: the owner side is erased for the same reason
  any,
  AnyIntentSchema
>;

/**
 * A definition with its own types erased, for code that only has to admit any concrete one: a
 * concrete definition is not assignable to the defaulted {@link Definition}, whose erased buckets
 * are a different shape than the ones it actually declared.
 */
// biome-ignore lint/suspicious/noExplicitAny: erasing the definition is the point of the alias
export type AnyDefinition = Definition<any, any>;

/**
 * An owner definition with the upload factory bound to it: the owner's schema is already concrete
 * here, so `ownedBy` is typed by it, and the owner is declared once.
 */
export type OwnedResourceOwnerDefinition<
  TServerContext = never,
  TSchema extends z.ZodType = z.ZodType,
> = ResourceOwnerDefinition<TServerContext, TSchema> & {
  upload: <TIntent extends z.ZodType | undefined = undefined>(
    contract: ResourceUpload<TServerContext, z.infer<TSchema>, TIntent>,
  ) => ResourceUpload<TServerContext, z.infer<TSchema>, TIntent>;
};

export type ResourceDefinition<
  TServerContext,
  TOwner extends ResourceOwnerDefinition<TServerContext> = ResourceOwnerDefinition<TServerContext>,
  TRead extends AnyResourceRead = AnyResourceRead,
  // Erased rather than the defaulted `ResourceUpload<TServerContext, z.infer<TOwner>>`: a contract
  // declaring an intent has a narrower `accept` argument, so it is not assignable to that one.
  TUpload extends AnyResourceUpload<TServerContext> = AnyResourceUpload<TServerContext>,
  TBucket extends string = Exclude<BucketNameOf<TServerContext>, typeof UPLOAD_BUCKET_KEY>,
> = Readonly<{
  /** The stored `kind`. Omit it to use the key the resource is mapped under. */
  kind?: string;
  /** The bucket the kind's assets live in, named after one the definition registered. */
  bucket: TBucket;
  owner: TOwner;
  read: TRead;
  /** How an upload into this kind is resolved. Omit it if the kind is never uploaded. */
  upload?: TUpload;
}>;

/**
 * Builds a resource kind. The mapping key is the stored `kind` unless the
 * two-argument form supplies one explicitly.
 */
export type ResourceFactory<TServerContext> = {
  <
    TOwner extends ResourceOwnerDefinition<TServerContext>,
    TDefinition extends ResourceDefinition<TServerContext, TOwner>,
  >(
    definition: TDefinition & { owner: TOwner },
  ): TDefinition;
  <
    TKind extends string,
    TOwner extends ResourceOwnerDefinition<TServerContext>,
    TDefinition extends ResourceDefinition<TServerContext, TOwner>,
  >(
    kind: TKind,
    definition: TDefinition & { owner: TOwner },
  ): TDefinition & { kind: TKind };
};

/**
 * Every resource kind the application supports, keyed by that kind: the key is
 * what a stored resource records as its `kind`, so a definition resource and
 * the rows it covers are matched by string equality.
 */
export type ResourceMap<TServerContext> = Record<string, ResourceDefinition<TServerContext>>;

export interface DefinitionBaseContext<TBuckets extends SuitcaseBuckets = SuitcaseBuckets> {
  readonly buckets: Readonly<TBuckets>;
}

/**
 * What a resource authorizer receives as `execution`: the context the consumer
 * declared through `withContext`, augmented with the definition's buckets.
 */
export type DefinitionServerContext<
  TSuppliedContext extends object,
  TBuckets extends SuitcaseBuckets,
> = DefinitionBaseContext<TBuckets> & TSuppliedContext;

/**
 * The result of {@link Suitcase}: the buckets the application's resources live
 * in and every resource kind it supports, keyed by the `kind` a stored resource
 * records.
 *
 * The supplied context is a type only. It is not validated at runtime — the
 * consumer of the library supplies a value of that type.
 */
export interface Definition<
  TSuppliedContext extends object = Record<never, never>,
  TBuckets extends SuitcaseBuckets = SuitcaseBuckets,
> {
  /** Bucket configs the resources read from and write to. */
  buckets: Readonly<TBuckets>;
  resources: ResourceMap<DefinitionServerContext<TSuppliedContext, TBuckets>>;
}

/**
 * Finds the definition of a stored resource kind.
 *
 * The map is keyed by the local name, which may differ from the stored `kind`
 * (the two-argument {@link ResourceFactory} form decouples them), so a direct
 * hit is tried first and the values are scanned otherwise.
 */
export const findDefinitionResource = <TResource extends { kind?: string }>(
  resources: Record<string, TResource>,
  kind: string,
): TResource | undefined =>
  resources[kind] ?? Object.values(resources).find((resource) => resource.kind === kind);

export type InferDefinitionExecutionContext<T extends Definition> =
  T extends Definition<infer C, infer _> ? C & DefinitionBaseContext : never;

/**
 * What the inference helpers need of a definition: its resource kinds, keyed by the local name in
 * `withResources`. Narrower than {@link Definition} on purpose — a concrete definition does not
 * satisfy that one, because its authorizers accept a more specific context than the base.
 */
export type DefinesResources = Readonly<{ resources: Record<string, object> }>;

export type InferDefinitionResources<T extends DefinesResources> = DefinitionResources<
  T["resources"]
>;

export type InferDefinitionResourceKinds<T extends DefinesResources> =
  keyof InferDefinitionResources<T> & string;

/** The upload contract a kind declares: what a transport needs to advertise and enforce. */
export type InferDefinitionUpload<
  T extends DefinesResources,
  TKind extends InferDefinitionResourceKinds<T> = InferDefinitionResourceKinds<T>,
> = TKind extends keyof T["resources"]
  ? T["resources"][TKind] extends { upload: infer TUpload }
    ? TUpload
    : never
  : never;

/** What the client must send as the intent, or `undefined` when the kind declares none. */
export type InferDefinitionUploadIntent<
  T extends DefinesResources,
  TKind extends InferDefinitionResourceKinds<T> = InferDefinitionResourceKinds<T>,
> = TKind extends keyof T["resources"]
  ? T["resources"][TKind] extends {
      upload: { intent?: infer TIntent extends z.ZodType | undefined };
    }
    ? UploadIntentOf<TIntent>
    : undefined
  : undefined;

/** The claim a kind requires, taken from the schema it declares. */
type DefinitionClaim<TResource> =
  TResource extends ResourceDefinition<infer _0, infer _1, infer TRead>
    ? TRead extends { claim: infer TClaim extends z.ZodType }
      ? z.infer<TClaim>
      : never
    : never;

/**
 * The claim each kind requires, keyed by the local name in `withResources`.
 *
 * Kinds that declare no claim are omitted, since a caller cannot supply one for them.
 */
export type InferDefinitionResourceClaims<T extends Definition> = {
  [K in keyof T["resources"] as [DefinitionClaim<T["resources"][K]>] extends [never]
    ? never
    : K]: DefinitionClaim<T["resources"][K]>;
};

/** The resource kinds the consumer writes in `withResources`. */
type DefinitionBody<
  TSuppliedContext extends object,
  TBuckets extends SuitcaseBuckets,
> = ResourceMap<DefinitionServerContext<TSuppliedContext, TBuckets>>;

/**
 * Every resource with the `kind` it is stored under: an explicit alias where
 * one was given, otherwise the key it is mapped under.
 */
export type DefinitionResources<
  TResources extends Record<string, object> = Record<string, object>,
> = {
  [K in keyof TResources]: TResources[K] & {
    kind: TResources[K] extends { kind: infer TAlias extends string } ? TAlias : K & string;
  };
};

type Factories<
  TSuppliedContext extends object,
  TBuckets extends SuitcaseBuckets = SuitcaseBuckets,
> = ReturnType<typeof createFactories<DefinitionServerContext<TSuppliedContext, TBuckets>>>;

interface DefinitionBuilder<
  TSuppliedContext extends object = Record<never, never>,
  TBuckets extends SuitcaseBuckets = SuitcaseBuckets,
> {
  /**
   * Declares the execution context the definition's authorizers receive, e.g.
   * the claims of the principal the server executes on behalf of.
   *
   * A type only, and optional: without it, `execution` is typed as
   * {@link DefinitionBaseContext}.
   */
  withContext: <TNextContext extends object>() => DefinitionBuilder<TNextContext, TBuckets>;

  /**
   * Registers the bucket configs the resources read from and write to.
   *
   * Optional: without it, the definition has no buckets. Taking the map as an
   * input rather than returning it keeps its exact type available inside
   * `withResources`, so authorizers see concrete bucket names instead of an
   * open record.
   */
  withBuckets: <TNextBuckets extends SuitcaseBuckets>(
    buckets: TNextBuckets,
  ) => DefinitionBuilder<TSuppliedContext, TNextBuckets>;

  /**
   * Declares the resource kinds, keyed by the `kind` a stored resource records.
   *
   * Terminal: the definition is complete once the kinds and buckets are known.
   */
  withResources: <T extends DefinitionBody<TSuppliedContext, TBuckets>>(
    callback: (args: Factories<TSuppliedContext, TBuckets>) => T,
  ) => { buckets: Readonly<TBuckets>; resources: DefinitionResources<T> };
}

const createResourceFactory = <TServerContext>(): ResourceFactory<TServerContext> => {
  function resource<
    TOwner extends ResourceOwnerDefinition<TServerContext>,
    T extends ResourceDefinition<TServerContext, TOwner>,
  >(definition: T & { owner: TOwner }): T;
  function resource<
    K extends string,
    TOwner extends ResourceOwnerDefinition<TServerContext>,
    T extends ResourceDefinition<TServerContext, TOwner>,
  >(kind: K, definition: T & { owner: TOwner }): T & { kind: K };
  function resource(
    kindOrDefinition: string | ResourceDefinition<TServerContext>,
    definition?: ResourceDefinition<TServerContext>,
  ) {
    return typeof kindOrDefinition === "string"
      ? { ...definition, kind: kindOrDefinition }
      : kindOrDefinition;
  }

  return resource;
};

/** The `read` factory: a scoped read infers its scope from `verify`, an open read has none. */
type ReadFactory<TServerContext> = {
  <TClaim extends z.ZodType, TScope>(
    definition: ScopedResourceRead<TServerContext, TClaim, TScope>,
  ): ScopedResourceRead<TServerContext, TClaim, TScope>;
  (definition: OpenResourceRead<TServerContext>): OpenResourceRead<TServerContext>;
};

/** Identity: the two overloads are the contract, nothing is transformed at runtime. */
const createReadFactory = <TServerContext>(): ReadFactory<TServerContext> =>
  ((definition: ResourceReadDefinition<TServerContext>) =>
    definition) as ReadFactory<TServerContext>;

export const createFactories = <TServerContext>() => ({
  /**
   * Creates an ownership definition, specifying who "owns" a particular resource.
   *
   * Owning is particularly useful, as it's used through the upload targeting on who
   * will finally own a resource. The owners can then _potentially_ manage a resource,
   * depending on the authorizer defined within this ownership definition.
   *
   * Ownership however doesn't guarantee retrieval, the `read()` definition controls
   * access to reading the resource, without relying on ownership.
   *
   * There are real-world examples on where someone only owns a resource and can manage it,
   * but another whole group of clients can look up the resource without owning it,
   * this relationship is demonstrated and configured in the `read()` definition.
   *
   * **Therefore, owning a resource does not imply read access; the `read()` definition
   * must explicitly grant it.**
   *
   * @human
   */
  owner: <TSchema extends z.ZodType>(
    definition: ResourceOwnerDefinition<TServerContext, TSchema>,
  ): OwnedResourceOwnerDefinition<TServerContext, TSchema> => ({
    ...definition,
    upload: <TIntent extends z.ZodType | undefined = undefined>(
      contract: ResourceUpload<TServerContext, z.infer<TSchema>, TIntent>,
    ) => contract,
  }),

  /**
   * Creates a resource read definition, for resources based on client-supplied claims.
   *
   * The read authorizer is called with the execution context and the read-context claim
   * that any client supplied.
   *
   * Some important points:
   * - `claim` is what the client sends about the resource context (like a named filter)
   * - `verify` is responsible for validating the claim and producing a scope
   * - `expose` uses the scope to determine which resources are visible to the client
   *
   * Claim is the **where**, verify is the **truth**, and expose is the **what**.
   *
   * It is important to note that `read` may not be called per resource, instead it is
   * called per `kind` of requested IDs. If you were to simply assume public-read using (...)
   * ```ts
   * read({ expose: () => true })
   * ```
   * (...) that is totally fine, even if a client were to submit resourceIds outside of this
   * resource `kind`, it will not be exposed as Suitcase already handles that internally.
   * **You can safely assume that the requested resource IDs _AND/OR_ the final exposed resource
   * IDs are actually belonging to this resource `kind`.**
   *
   * @human
   */
  read: createReadFactory<TServerContext>(),

  /**
   * Create a new resource definition.
   *
   * A resource definition is literally just that: a defined resource with its app-wide
   * **unique kind** parameter; its authorizers and any other metadata that defines how
   * something is uploaded, managed, authorized, read and exposed, aswell as what can
   * be uploaded in the first place by any client.
   *
   * @human
   */
  resource: createResourceFactory<TServerContext>(),
});

/** Fills in each resource's stored `kind`: an explicit alias wins over the key. */
const bindResourceKinds = <TResources extends Record<string, object>>(
  resources: TResources,
): DefinitionResources<TResources> =>
  Object.fromEntries(
    Object.entries(resources).map(([kind, resource]) => [kind, { kind, ...resource }] as const),
  ) as DefinitionResources<TResources>;

const createDefinitionBuilder = <
  TSuppliedContext extends object = Record<never, never>,
  TBuckets extends SuitcaseBuckets = SuitcaseBuckets,
>(
  buckets: Readonly<TBuckets>,
): DefinitionBuilder<TSuppliedContext, TBuckets> => ({
  withContext: <TNextContext extends object>() =>
    createDefinitionBuilder<TNextContext, TBuckets>(buckets),
  withBuckets: <TNextBuckets extends SuitcaseBuckets>(next: TNextBuckets) =>
    createDefinitionBuilder<TSuppliedContext, TNextBuckets>(next),
  withResources: <T extends DefinitionBody<TSuppliedContext, TBuckets>>(
    callback: (args: Factories<TSuppliedContext, TBuckets>) => T,
  ) => ({
    buckets,
    resources: bindResourceKinds(
      callback(createFactories<DefinitionServerContext<TSuppliedContext, TBuckets>>()),
    ),
  }),
});

// The empty builder precedes `withBuckets`: `SuitcaseBuckets` requires the
// upload bucket, which a definition supplies before `withResources`.
export const Suitcase: DefinitionBuilder = createDefinitionBuilder({} as SuitcaseBuckets);
