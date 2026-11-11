import z from "zod";
import { AssetData } from "./asset.js";

/**
 * An upload session represents the attempt to upload a digital asset
 * to the system, being resolved into a resource upon successful completion.
 *
 * It is a gated process that ensures the integrity and ownership of the
 * uploaded asset before it is finalized as a resource and potential asset.
 * It also contains the lifecycle of the upload progress, which we can later
 * expand into Multipart Uploads in the future.
 */
export type UploadSession = z.infer<typeof UploadSessionSchema>;

export type UploadStatus = (typeof UploadStatus)[keyof typeof UploadStatus];

export type UploadTarget = z.infer<typeof UploadTargetSchema>;

export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

export const UploadSessionSchema = AssetData.extend({
  id: z.uuid(),
  status: z.lazy(() => z.enum(UploadStatus)),

  // Foreign key, as we're database-agnostic it's a simple representation.
  // It represents the resource that was created as a result of this upload.
  resourceId: z.uuid().nullable(),

  // We only store the target, as server resolvers resolve ownership based on it.
  // The consumers of our API can then determine ownership based off of it.
  target: z.lazy(() => UploadTargetSchema),

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

export const UploadTargetSchema = z
  .record(z.string(), z.unknown())
  // Unique identifiable type of the upload target (required for discriminator)
  .and(z.object({ kind: z.string() }));

export const UploadMetadataSchema = z.record(z.string(), z.unknown()).nullable();

export const UploadStatus = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
});
