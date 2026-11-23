import z from "zod";

/**
 * An asset represents a digital file stored in the system,
 * including its metadata and physical storage details.
 *
 * It does not include user-defined metadata or ownership information, as
 * it literally IS the domain of the physical storage in a external system.
 *
 * @human
 */
export type Asset = z.infer<typeof AssetSchema>;

export type AssetData = z.infer<typeof AssetData>;

export type AssetHash = z.infer<typeof AssetHashSchema>;

export type AssetHashAlgorithm = (typeof AssetHashAlgorithm)[keyof typeof AssetHashAlgorithm];

export type AssetDownloadUrl = z.infer<typeof AssetDownloadUrlSchema>;

export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const AssetHashAlgorithm = Object.freeze({
  SHA256: "sha256",
  SHA512: "sha512",
  // ... We later extend this if we need to to support more storage solutions
});

export const AssetHashSchema = z.object({
  /**
   * Lowercase hex of the raw digest bytes. URL-safe and unambiguous, so the hash
   * can also serve as an identity and as part of an object key.
   *
   * Storage backends that expect a different encoding convert at their own
   * boundary.
   */
  hashHex: z.string().regex(/^[a-f0-9]+$/, "hashHex must be lowercase hex"),
  hashAlgorithm: z.enum(AssetHashAlgorithm),
});

export const AssetData = AssetHashSchema.extend({
  // The size in bytes of the uploaded file
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
});

export const AssetSchema = AssetData.extend({
  id: z.uuid(),

  // The lifecycle of the physical file. A delete marks the row instead of removing it, so the
  // bytes can be purged out of band and reused in the meantime; the purge then claims the row
  // while it removes them.
  status: z.lazy(() => z.enum(AssetStatus)),

  // When the asset was marked deleted. Null while it is active.
  deletedAt: z.iso.datetime().nullable(),

  // The storage bucket where the asset is located. This is from a S3 compatible
  // storage service, however the exact implementation details CAN vary.
  bucket: z.string(),

  // Our physical file location relative to our bucket (root),
  // specifically relevant in the context of S3.
  key: z.string(),
});

export const AssetStatus = Object.freeze({
  ACTIVE: "active",
  DELETED: "deleted",
  PURGING: "purging",
});

export const AssetDownloadUrlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("signed"),
    url: z.url(),
    expiresAt: z.iso.datetime(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("public"),
    url: z.url(),
  }),
]);
