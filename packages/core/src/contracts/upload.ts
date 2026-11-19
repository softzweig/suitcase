import z from "zod";
import { AssetData } from "../schemas/asset.js";
import type { ResourceMetadata } from "../schemas/resource.js";
import { ResourceMetadataSchema, ResourceSchema } from "../schemas/resource.js";
import { UploadSessionSchema } from "../schemas/upload.js";

/**
 * The upload operations a client and a backend agree on.
 *
 * The intent is declared by the resource definition, so the request stays a type and the
 * transport composes its schema from the kind's own. Everything else here is static.
 *
 * How long a session lives, and whether the backend may reuse bytes it already stores, are not
 * part of this agreement: they are the backend's own policy and it applies them itself.
 */
export type UploadConstraintsResult = z.infer<typeof UploadConstraintsResultSchema>;

export type UploadConstraintsRequest = z.infer<typeof UploadConstraintsRequestSchema>;

/**
 * Upload claims describe what the client states about the physical file being uploaded, including
 * its name, and any extra client-defined metadata.
 *
 * The data within claims cannot be trusted blindly, and it isn't within services; instead it is
 * used to enforce constraints upon upload, being verified and compared against the uploaded
 * physical file. Using claims to determine authorization however does not guarantee that every
 * claim is valid (primarily only the claims defined in {@link AssetData}).
 *
 * @human
 */
export type UploadClaims<TIntent = undefined> = AssetData & {
  /** The original file name. */
  fileName: string;
  /** What the client stated about this upload, validated by the kind's intent schema. */
  intent?: TIntent;
  /** Consumer-supplied metadata, kept on the session for the finalizer. */
  metadata?: ResourceMetadata;
};

export type UploadTarget = z.infer<typeof UploadTargetSchema>;

export type UploadInitializeRequest<TIntent = undefined> = {
  kind: string;
  claims: UploadClaims<TIntent>;
};

export type UploadInitializeResult = z.infer<typeof UploadInitializeResultSchema>;

export type UploadFinalizeRequest = z.infer<typeof UploadFinalizeRequestSchema>;

export type UploadFinalizeResult = z.infer<typeof UploadFinalizeResultSchema>;

/** What a kind enforces, answered before a file is picked. `maxSize` is bytes or an operand. */
export const UploadConstraintsRequestSchema = z.object({
  kind: z.string(),
});

export const UploadConstraintsResultSchema = z.object({
  maxSize: z.union([z.string(), z.number()]).nullable(),
  mimeTypes: z.array(z.string()).nullable(),
  hasIntent: z.boolean(),
});

/**
 * The claims schema, built from the kind's own intent schema. A kind that declares no intent passes
 * nothing, and then any intent in the request is refused.
 */
export const UploadClaimsSchema = <TIntent extends z.ZodType = z.ZodType>(intent?: TIntent) =>
  AssetData.extend({
    fileName: UploadSessionSchema.shape.fileName,
    intent: (intent ?? z.never()).optional(),
    metadata: ResourceMetadataSchema.optional(),
  }) satisfies z.ZodType<UploadClaims<z.infer<TIntent>>>;

/** Where to put the bytes, as the storage layer hands it out. */
export const UploadTargetSchema = z.object({
  url: z.url(),
  method: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  expiresAt: z.iso.datetime().optional(),
});

/** The initialize request, with the claims built from the kind's own intent schema. */
export const UploadInitializeRequestSchema = <TIntent extends z.ZodType = z.ZodType>(
  intent?: TIntent,
) =>
  z.object({
    kind: z.string(),
    claims: UploadClaimsSchema(intent),
  }) satisfies z.ZodType<UploadInitializeRequest<z.infer<TIntent>>>;

/** Either an upload to perform, or the resource that already holds the bytes. */
export const UploadInitializeResultSchema = z.discriminatedUnion("reused", [
  z.object({ upload: UploadSessionSchema, reused: z.literal(true), resource: ResourceSchema }),
  z.object({ upload: UploadSessionSchema, reused: z.literal(false), target: UploadTargetSchema }),
]);

export const UploadFinalizeRequestSchema = z.object({
  uploadId: z.uuid(),
});

export const UploadFinalizeResultSchema = z.object({
  upload: UploadSessionSchema,
  resource: ResourceSchema,
});
