import z from "zod";
import { AssetData } from "./asset.js";
import { ResourceOwnerSchema } from "./shared.js";

/**
 * An upload session represents the attempt to upload a digital asset
 * to the system, being resolved into a resource upon successful completion.
 *
 * It is a gated process that ensures the integrity and ownership of the
 * uploaded asset before it is finalized as a resource and potential asset.
 * It also contains the lifecycle of the upload progress, which we can later
 * expand into Multipart Uploads in the future.
 *
 * @human
 */
export type UploadSession = z.infer<typeof UploadSessionSchema>;

export type UploadStatus = (typeof UploadStatus)[keyof typeof UploadStatus];

/** The parts of a target that describe ownership; the kind lives on the session. */
export type UploadTargetPayload = z.infer<typeof UploadTargetPayloadSchema>;

/** A target with the discriminator folded back in, for readers that need both. */
export type UploadTarget = { kind: string } & UploadTargetPayload;

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

export const UploadSessionSchema = AssetData.extend({
  id: z.uuid(),
  status: z.lazy(() => z.enum(UploadStatus)),

  // Foreign key, as we're database-agnostic it's a simple representation.
  // It represents the resource that was created as a result of this upload.
  resourceId: z.uuid().nullable(),

  // The kind this upload resolves into. A column rather than part of `target`, so it can be
  // queried and indexed, and so a target can never claim a kind the session was not created for.
  kind: z.string().max(512),

  // Who the upload is for, resolved once at init by the consumer's `ownedBy` and validated
  // against the kind's owner schema. Stored instead of re-derived at finalize because `ownedBy`
  // may read the execution context, and finalize need not carry the same one, or run the same
  // code, as init. Finalize therefore copies this owner onto the resource rather than guessing.
  owner: ResourceOwnerSchema,

  // The consumer-defined payload the upload resolves against, e.g. a bucket and key. Ownership
  // is not read out of it: that is `owner` above, an explicit decision made once at init.
  target: z.lazy(() => UploadTargetPayloadSchema),

  // Metadata that can be supplied by consumers of the API. This essentially
  // could represent any authentication information, e.g. the uploaderUserId
  // or additional metadata that can be used by our finalizers.
  metadata: z.lazy(() => UploadMetadataSchema),

  // The original file name of the uploaded asset
  fileName: z.string().min(1).max(512).trim(),

  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
});

export const UploadTargetPayloadSchema = z.record(z.string(), z.unknown());

/** The session's target with its discriminator, which is what a resolver reads. */
export const uploadTargetOf = (session: UploadSession): UploadTarget => ({
  kind: session.kind,
  ...session.target,
});

export const UploadMetadataSchema = z.record(z.string(), z.unknown()).nullable();

export const UploadStatus = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
});
