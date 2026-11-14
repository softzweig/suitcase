import type z from "zod";
import type {
  ResourceOwnerAuthorizer,
  ResourceReadAuthorizer,
} from "./services/resource.authorizers.js";
import type { ResourceService, ResourceServiceContext } from "./services/resource.service.js";
import type { SuitcaseBuckets } from "./storage/storage.buckets.js";

export type ResourceTransactionContext = ResourceServiceContext & {
  resourceService: ResourceService;
};

export type ResourceOwnerDefinition<
  TServerContext = never,
  TSchema extends z.ZodType = z.ZodType,
> = {
  /** Define the owner schema, that is reused by upload target resolve logic (consumer-defined) */
  schema: TSchema;
  /** Define whether a certain mutation can be made on this owner (only `true` allows it) */
  authorize: ResourceOwnerAuthorizer<z.infer<TSchema>, TServerContext, ResourceTransactionContext>;
};

export type ResourceReadDefinition<
  TServerContext = never,
  TSchema extends z.ZodType = z.ZodType,
> = {
  /** Define the "read-context" which a user supplies to resolve a resource. */
  context?: TSchema;
  /** Define the authorization logic for the read operation (owner-unaware; you may need to fetch) */
  authorize: ResourceReadAuthorizer<z.infer<TSchema>, TServerContext, ResourceTransactionContext>;
};

export type ResourceDefinition<
  TServerContext,
  TOwner extends ResourceOwnerDefinition<TServerContext> = ResourceOwnerDefinition<TServerContext>,
  TRead extends ResourceReadDefinition<TServerContext> = ResourceReadDefinition<TServerContext>,
> = {
  /** The stored `kind`. Omit it to use the key the resource is mapped under. */
  kind?: string;
  owner: TOwner;
  read: TRead;
  mimeTypes: string[];
  maxSize?: number;
};

/**
 * Builds a resource kind. The mapping key is the stored `kind` unless the
 * two-argument form supplies one explicitly.
 */
export type ResourceFactory<TServerContext> = {
  <T extends ResourceDefinition<TServerContext>>(definition: T): T;
  <K extends string, T extends ResourceDefinition<TServerContext>>(
    kind: K,
    definition: T,
  ): T & { kind: K };
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

export type InferDefinitionResources<T extends Definition> =
  T extends Definition<infer _, infer _> ? DefinitionResources<T["resources"]> : never;

export type InferDefinitionResourceContexts<T extends Definition> =
  T extends Definition<infer C, infer _>
    ? { [K in keyof InferDefinitionResources<T>]: C & DefinitionBaseContext }
    : never;

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
  function resource<T extends ResourceDefinition<TServerContext>>(definition: T): T;
  function resource<K extends string, T extends ResourceDefinition<TServerContext>>(
    kind: K,
    definition: T,
  ): T & { kind: K };
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

export const createFactories = <TServerContext>() => ({
  owner: <TSchema extends z.ZodType>(
    definition: ResourceOwnerDefinition<TServerContext, TSchema>,
  ) => definition,
  read: <TSchema extends z.ZodType>(definition: ResourceReadDefinition<TServerContext, TSchema>) =>
    definition,
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
