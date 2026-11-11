import type { AssetHash, AssetHashAlgorithm } from "@softzweig/suitcase-core";
import type { GetObjectOptions, StoredObject } from "@softzweig/suitcase-server";

/** Request/response fields S3 uses to carry a checksum, each a base64 digest. */
export type S3ChecksumField =
  | "ChecksumCRC32"
  | "ChecksumCRC32C"
  | "ChecksumCRC64NVME"
  | "ChecksumSHA1"
  | "ChecksumSHA256"
  | "ChecksumSHA512";

/** Fields shared by `HeadObject`, `GetObject` and `ListObjectsV2` entries. */
export type S3ObjectMetadata = {
  ContentLength?: number;
  Size?: number;
  ContentType?: string;
  ETag?: string;
  LastModified?: Date;
  Metadata?: Record<string, string>;
  ChecksumCRC32?: string;
  ChecksumCRC32C?: string;
  ChecksumCRC64NVME?: string;
  ChecksumSHA1?: string;
  ChecksumSHA256?: string;
  ChecksumSHA512?: string;
};

/**
 * Maps every algorithm core allows onto the S3 field able to verify it.
 *
 * Adding an algorithm to `AssetHashAlgorithm` is a type error until it is mapped
 * here, so support cannot silently drift.
 *
 * S3 also exposes MD5, CRC32/CRC32C/CRC64NVME and XXHASH variants. They are
 * deliberately absent: MD5 is cryptographically broken and the others are
 * non-cryptographic, so none of them may identify an asset.
 */
export const S3_CHECKSUM_FIELDS = Object.freeze<Record<AssetHashAlgorithm, S3ChecksumField>>({
  sha256: "ChecksumSHA256",
  sha512: "ChecksumSHA512",
});

/** The table above fixes the keys; `Object.entries` widens them back to `string`. */
const CHECKSUMS = Object.entries(S3_CHECKSUM_FIELDS) as readonly (readonly [
  AssetHashAlgorithm,
  S3ChecksumField,
])[];

/** Checksum headers must be sent verbatim by the client, never hoisted into the URL. */
export const CHECKSUM_HEADERS = Object.freeze([
  "x-amz-checksum-crc32",
  "x-amz-checksum-crc32c",
  "x-amz-checksum-crc64nvme",
  "x-amz-checksum-sha1",
  "x-amz-checksum-sha256",
  "x-amz-checksum-sha512",
  "x-amz-sdk-checksum-algorithm",
]);

/** S3 reports checksums base64-encoded, while `AssetHash` stores hex. */
const hexFromBase64 = (value: string): string => Buffer.from(value, "base64").toString("hex");

const base64FromHex = (value: string): string => Buffer.from(value, "hex").toString("base64");

/** Picks whichever checksum S3 reported, tagged with the algorithm that produced it. */
export function checksumFrom(source: S3ObjectMetadata): AssetHash | undefined {
  for (const [hashAlgorithm, field] of CHECKSUMS) {
    if (!source[field]) continue;
    return { hashHex: hexFromBase64(source[field]), hashAlgorithm };
  }

  return undefined;
}

/** The request parameter carrying `checksum`, named after its algorithm. */
export const checksumParams = (checksum: AssetHash): Partial<Record<S3ChecksumField, string>> => ({
  [S3_CHECKSUM_FIELDS[checksum.hashAlgorithm]]: base64FromHex(checksum.hashHex),
});

export const toStoredObject = (key: string, source: S3ObjectMetadata): StoredObject => ({
  key,
  size: source.ContentLength ?? source.Size ?? 0,
  contentType: source.ContentType,
  etag: source.ETag,
  lastModified: source.LastModified ?? new Date(),
  metadata: source.Metadata,
  checksum: checksumFrom(source),
});

export const toRange = (range?: GetObjectOptions["range"]): string | undefined =>
  range ? `bytes=${range.start}-${range.end ?? ""}` : undefined;

export const expiresAt = (from: Date, seconds: number): Date =>
  new Date(from.getTime() + seconds * 1000);
