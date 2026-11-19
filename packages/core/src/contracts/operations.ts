import z from "zod";
import type { ServiceResult } from "../schemas/result.js";
import type { ClientDefinition } from "./definition.js";
import {
  ResourceDeleteRequestSchema,
  ResourceDeleteResultSchema,
  ResourceResolveRequestSchema,
  ResourceResolveResultSchema,
  ResourceUpdateRequestSchema,
  ResourceUpdateResultSchema,
} from "./resource.js";
import {
  type UploadClaims,
  UploadConstraintsRequestSchema,
  UploadConstraintsResultSchema,
  UploadFinalizeRequestSchema,
  UploadFinalizeResultSchema,
  UploadInitializeRequestSchema,
  UploadInitializeResultSchema,
} from "./upload.js";

/** The operations a client and a backend agree on, by name. */
export type Operation = keyof typeof OperationSchemas;

export type OperationInput<TOperation extends Operation> = z.infer<
  (typeof OperationSchemas)[TOperation]["input"]
>;

export type OperationOutput<TOperation extends Operation> = z.infer<
  (typeof OperationSchemas)[TOperation]["output"]
>;

/** A call as a transport receives it, discriminated on the operation it names. */
export type OperationRequest = {
  [TOperation in Operation]: { operation: TOperation; input: OperationInput<TOperation> };
}[Operation];

/** What carries a client's calls, typed so a transport cannot drift from the schemas. */
export interface SuitcaseTransport {
  call<TOperation extends Operation>(request: {
    operation: TOperation;
    input: OperationInput<TOperation>;
  }): Promise<OperationOutput<TOperation>>;
}

/** One operation as a method: what it takes, and what it resolves to. */
type OperationMethod<TOperation extends Operation, TInput = OperationInput<TOperation>> = (
  input: TInput,
) => Promise<OperationOutput<TOperation>>;

/**
 * A contract's input with some fields retyped from the definition. Unnamed fields still come from
 * the contract, so one it gains later reaches callers instead of being quietly dropped.
 */
type Narrow<TInput, TPatch> = Omit<TInput, keyof TPatch> & TPatch;

/** The resource kinds a definition names: the strings an operation's `kind` accepts. */
export type ClientResourceKind<TDefinition extends ClientDefinition> =
  keyof TDefinition["resources"] & string;

/** The claim per kind a resolve may carry; a kind that asks for none ends up as `kind?: never`. */
export type ClientResolveClaims<TDefinition extends ClientDefinition> = Partial<{
  [TKind in ClientResourceKind<TDefinition>]: TDefinition["resources"][TKind]["read"];
}>;

/**
 * One kind's initialize input, with the claims bound to the intent it declares. The intent is
 * optional because a claim set is built before the kind's requiredness is known; `DeclaredField`
 * is where a caller-facing surface makes it required.
 */
export type ClientUploadInitialize<
  TDefinition extends ClientDefinition,
  TKind extends ClientResourceKind<TDefinition> = ClientResourceKind<TDefinition>,
> = Narrow<
  OperationInput<"uploads.initialize">,
  { kind: TKind; claims: UploadClaims<TDefinition["resources"][TKind]["uploadIntent"]> }
>;

/** Starts an upload, keeping `kind` and the intent inside `claims` correlated per kind. */
type UploadMethod<TDefinition extends ClientDefinition> = <
  TKind extends ClientResourceKind<TDefinition>,
>(
  input: ClientUploadInitialize<TDefinition, TKind>,
) => Promise<OperationOutput<"uploads.initialize">>;

/** A resolve, with the claims bound to the kinds the definition declares. */
type ResolveInput<TDefinition extends ClientDefinition> = Narrow<
  OperationInput<"resources.resolve">,
  { claims: ClientResolveClaims<TDefinition> }
>;

/** A constraints request, limited to the kinds the definition declares. */
type ConstraintsInput<TDefinition extends ClientDefinition> = Narrow<
  OperationInput<"uploads.constraints">,
  { kind: ClientResourceKind<TDefinition> }
>;

/**
 * The operations as a client calls them: one method each, grouped the way the names are grouped,
 * with a definition replacing the contract's permissive placeholders (`resolve` claims, upload
 * intent). The wire itself is {@link SuitcaseTransport}; this is only what a caller sees.
 *
 * The other end of {@link ServiceOperations}: the same calls, unwrapped to their payload and
 * narrowed to one definition. Neither replaces the other, because a transport needs the flat names
 * and raw inputs, and a caller wants the nested, typed ones.
 */
export interface ClientOperations<TDefinition extends ClientDefinition = ClientDefinition> {
  readonly resources: {
    readonly delete: OperationMethod<"resources.delete">;
    readonly resolve: OperationMethod<"resources.resolve", ResolveInput<TDefinition>>;
    readonly update: OperationMethod<"resources.update">;
  };
  readonly uploads: {
    readonly constraints: OperationMethod<"uploads.constraints", ConstraintsInput<TDefinition>>;
    readonly finalize: OperationMethod<"uploads.finalize">;
    readonly initialize: UploadMethod<TDefinition>;
  };
}

/**
 * The operations as a server serves them: the contract's input in, its result out. A transport
 * binds this and knows nothing else about the api behind it.
 *
 * The other end of {@link ClientOperations}, and flat rather than nested so a transport can
 * dispatch on an operation name it read from the wire.
 */
export type ServiceOperations = {
  [TOperation in Operation]: (
    input: OperationInput<TOperation>,
  ) =>
    | ServiceResult<OperationOutput<TOperation>>
    | PromiseLike<ServiceResult<OperationOutput<TOperation>>>;
};

/** Pairs an operation name with the transport, so a method is a name and a hand-off. */
const bind =
  <TOperation extends Operation>(transport: SuitcaseTransport, operation: TOperation) =>
  (input: OperationInput<TOperation>): Promise<OperationOutput<TOperation>> =>
    transport.call({ operation, input });

/** Creates the operations over any transport: fetch, IPC, or a test double. */
export const createSuitcaseOperations = <TDefinition extends ClientDefinition = ClientDefinition>({
  transport,
}: Readonly<{
  transport: SuitcaseTransport;
}>): ClientOperations<TDefinition> => ({
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

/** The operations as schemas, for a transport that validates what it is handed (loosely-typed). */
export const OperationSchemas = Object.freeze({
  "resources.delete": {
    input: ResourceDeleteRequestSchema,
    output: ResourceDeleteResultSchema,
  },
  "resources.resolve": {
    input: ResourceResolveRequestSchema(z.unknown()),
    output: ResourceResolveResultSchema,
  },
  "resources.update": {
    input: ResourceUpdateRequestSchema,
    output: ResourceUpdateResultSchema,
  },
  "uploads.constraints": {
    input: UploadConstraintsRequestSchema,
    output: UploadConstraintsResultSchema,
  },
  "uploads.finalize": {
    input: UploadFinalizeRequestSchema,
    output: UploadFinalizeResultSchema,
  },
  "uploads.initialize": {
    input: UploadInitializeRequestSchema(z.unknown()),
    output: UploadInitializeResultSchema,
  },
});
