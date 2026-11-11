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

  // The storage bucket where the asset is located. This is from a S3 compatible
  // storage service, however the exact implementation details CAN vary.
  bucket: z.string(),

  // Our physical file location relative to our bucket (root),
  // specifically relevant in the context of S3.
  key: z.string(),
});
