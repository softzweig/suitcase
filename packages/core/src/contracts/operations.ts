import z from "zod";
import {
  ResourceDeleteRequestSchema,
  ResourceDeleteResultSchema,
  ResourceResolveRequestSchema,
  ResourceResolveResultSchema,
  ResourceUpdateRequestSchema,
  ResourceUpdateResultSchema,
} from "./resource.js";
import {
  UploadConstraintsRequestSchema,
  UploadConstraintsResultSchema,
  UploadFinalizeRequestSchema,
  UploadFinalizeResultSchema,
  UploadInitializeRequestSchema,
  UploadInitializeResultSchema,
} from "./upload.js";

export type Operation = keyof OperationMap;

export type OperationMap = Readonly<{
  [TOperation in keyof typeof OperationSchemas]: Readonly<{
    input: z.infer<(typeof OperationSchemas)[TOperation]["input"]>;
    output: z.infer<(typeof OperationSchemas)[TOperation]["output"]>;
  }>;
}>;

export type OperationInput<TOperation extends Operation> = OperationMap[TOperation]["input"];

export type OperationOutput<TOperation extends Operation> = OperationMap[TOperation]["output"];

/** A call as a transport receives it, discriminated on the operation it names. */
export type OperationRequest = {
  [TOperation in Operation]: { operation: TOperation; input: OperationInput<TOperation> };
}[Operation];

/**
 * What carries a client's calls. Typed against the operation map, so a transport is written once
 * and every call site is checked against it rather than against a string and an `unknown`.
 */
export interface SuitcaseTransport {
  call<TOperation extends Operation>(request: {
    operation: TOperation;
    input: OperationInput<TOperation>;
  }): Promise<OperationOutput<TOperation>>;
}

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
