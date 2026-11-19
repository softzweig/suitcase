import type {
  ClientDefinition,
  Operation,
  OperationInput,
  OperationOutput,
  SuitcaseTransport,
  UploadClaims,
} from "@softzweig/suitcase-core/contracts";

/** One operation as a method: what it takes, and what it resolves to. */
type OperationMethod<TOperation extends Operation, TInput = OperationInput<TOperation>> = (
  input: TInput,
) => Promise<OperationOutput<TOperation>>;

/**
 * One field of a contract's input, retyped from the definition's schemas.
 *
 * Every override goes through this instead of restating the input, so a field the contract gains
 * later reaches the client by itself: restated inputs would keep compiling while quietly
 * refusing to send it.
 */
type Replace<TInput, TField extends keyof TInput, TValue> = Omit<TInput, TField> & {
  [TKey in TField]: TValue;
};

/** The resource kinds a definition names: the strings an operation's `kind` accepts. */
export type ClientResourceKind<TDefinition extends ClientDefinition> =
  keyof TDefinition["resources"] & string;

/** The claim a kind requires in order to read its resources. */
type ClientReadClaim<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition>,
> = TDefinition["resources"][TKind]["read"];

/**
 * The claim per kind a resolve may carry.
 *
 * Partial on both counts: one call may span several kinds, and a kind whose read takes no claim
 * asks for nothing, so it is left out rather than demanded as `never`.
 */
export type ClientResolveClaims<TDefinition extends ClientDefinition> = Partial<{
  [TKind in ClientResourceKind<TDefinition> as [ClientReadClaim<TDefinition, TKind>] extends [never]
    ? never
    : TKind]: ClientReadClaim<TDefinition, TKind>;
}>;

/**
 * What one kind accepts to start an upload: the contract's own initialize input, with the claims
 * bound to the intent that kind declares.
 *
 * The intent stays optional here, since a claim set is built by a workflow that cannot know at
 * compile time whether the kind required one. `UploadStart` is where that requiredness is
 * enforced, because that is the surface a caller fills in.
 */
export type ClientUploadInitialize<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition> = ClientResourceKind<TDefinition>,
> = Replace<
  Replace<OperationInput<"uploads.initialize">, "kind", TKind>,
  "claims",
  UploadClaims<TDefinition["resources"][TKind]["uploadIntent"]>
>;

/** Starts an upload, keeping `kind` and the intent inside `claims` correlated per kind. */
type UploadMethod<TDefinition extends ClientDefinition> = <
  TKind extends ClientResourceKind<TDefinition>,
>(
  input: ClientUploadInitialize<TDefinition, TKind>,
) => Promise<OperationOutput<"uploads.initialize">>;

/**
 * Every operation the contracts define, as one method each, grouped the way the server groups
 * them.
 *
 * This is the wire, not the workflow: each method is a name and a hand-off, so it stays a
 * projection of the operation map and never grows a policy of its own. Supplying a definition
 * replaces the contract's permissive placeholders on the kind-scoped operations with that
 * definition's schemas: claims keyed by kind on `resolve`, and an intent that belongs to the kind
 * being initialized. Without one, this is exactly what the contracts describe.
 *
 * `assets` and `finalize` stay as the contracts define them under any definition: a download link
 * is decided by the read authorization that produced the resource, and a finalize names a
 * session rather than a kind.
 *
 * The workflows a consumer actually calls live one level up, in `createSuitcaseClient`, which also
 * leaves `assets` out: a resource's link already comes from `resolve`, and `assets.delete` has no
 * authorizer to stand between a caller and the cascade it performs.
 */
export interface SuitcaseOperations<TDefinition extends ClientDefinition = ClientDefinition> {
  readonly resources: {
    readonly delete: OperationMethod<"resources.delete">;
    readonly resolve: OperationMethod<
      "resources.resolve",
      Replace<OperationInput<"resources.resolve">, "claims", ClientResolveClaims<TDefinition>>
    >;
    readonly update: OperationMethod<"resources.update">;
  };
  readonly uploads: {
    readonly constraints: OperationMethod<
      "uploads.constraints",
      Replace<OperationInput<"uploads.constraints">, "kind", ClientResourceKind<TDefinition>>
    >;
    readonly finalize: OperationMethod<"uploads.finalize">;
    readonly initialize: UploadMethod<TDefinition>;
  };
}

/** Pairs an operation name with the transport, so a method is a name and a hand-off. */
const bind =
  <TOperation extends Operation>(transport: SuitcaseTransport, operation: TOperation) =>
  (input: OperationInput<TOperation>): Promise<OperationOutput<TOperation>> =>
    transport.call({ operation, input });

/**
 * Creates the operations over any transport: fetch, IPC, or a test double.
 *
 * Leave the definition out for the contract-level surface, or supply the one the backend was
 * built from to have `resolve` and `initialize` checked against its schemas. The narrowing is
 * type-only: nothing is validated or re-mapped at runtime, and no cast is needed, because a
 * definition's claims and intent are part of what the contract already accepts.
 */
export const createSuitcaseOperations = <TDefinition extends ClientDefinition = ClientDefinition>({
  transport,
}: Readonly<{
  transport: SuitcaseTransport;
}>): SuitcaseOperations<TDefinition> => ({
  resources: {
    delete: bind(transport, "resources.delete"),
    resolve: bind(transport, "resources.resolve"),
    update: bind(transport, "resources.update"),
  },
  uploads: {
    constraints: bind(transport, "uploads.constraints"),
    finalize: bind(transport, "uploads.finalize"),
    initialize: bind(transport, "uploads.initialize"),
  },
});
