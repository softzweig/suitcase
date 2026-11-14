import { z } from "zod";
import type { Asset } from "./asset.js";
import { UploadSessionSchema } from "./upload.js";

/**
 * A resource represents a digital asset that is owned by a specific ownership
 * entity. It is NOT the deduplicated physical asset itself, but rather a
 * authorized representation of it.
 *
 * @human
 */
export type Resource = z.infer<typeof ResourceSchema>;

export type ResourceWithAsset = Resource & { asset: Asset };

export type ResourceOwner = z.infer<typeof ResourceOwnerSchema>;

export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;

export const ResourceSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  owner: z.lazy(() => ResourceOwnerSchema),

  // The kind of resource: an app-wide unique string identifying this
  // resource and handled accordingly within the application logic. A server
  // definition keys its resource map by this value.
  kind: z.string().max(512),

  // Optional naming of the resource. This does not represent the original
  // file name or the physical asset itself, it's a default defined label
  // supported out-of-the-box.
  label: z.string().max(255).nullable(),

  // Original file name (copied over on finalization from upload session)
  fileName: UploadSessionSchema.shape.fileName,

  // Metadata that can be supplied by consumers of the API. This essentially
  // could represent any authentication information, e.g. the uploaderUserId
  // or additional metadata that can be used by our finalizers.
  metadata: z.lazy(() => ResourceMetadataSchema),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
});

// Essentially a 1:1 of UploadMetadataSchema, however semantically it's
// differentiated to represent resource-specific metadata, even though a
// consumer can still use `uploadSession.metadata` if passthrough is wanted.
export const ResourceMetadataSchema = z.record(z.string(), z.unknown()).nullable();

export const ResourceOwnerSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
