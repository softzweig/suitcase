import type { AssetHash, AssetHashAlgorithm } from "@softzweig/suitcase-core";
import type {
  CreateUploadUrlInput,
  GetObjectOptions,
  StoredObject,
} from "@softzweig/suitcase-server";

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

/** What a client must replay for a presigned upload, and what must stay signed. */
export interface UploadSignature {
  /** Headers the client must send verbatim, derived from the inputs actually set. */
  readonly headers: Readonly<Record<string, string>>;
  /** Headers S3 would otherwise move into the query string, so they stay headers. */
  readonly unhoistable: readonly string[];
}

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

/** Header carrying a checksum; S3 names it after the algorithm that produced it. */
export const S3_CHECKSUM_HEADERS = Object.freeze<Record<AssetHashAlgorithm, string>>({
  sha256: "x-amz-checksum-sha256",
  sha512: "x-amz-checksum-sha512",
});

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

/**
 * Derives the signature contract for an upload from its inputs alone.
 *
 * Nothing is included speculatively: signing a header the caller did not set
 * forces the client to reproduce a value it cannot know, which is how a
 * presigned URL ends up rejected with `SignatureDoesNotMatch`.
 */
export function uploadSignature(input: CreateUploadUrlInput): UploadSignature {
  const { contentType, contentLength, checksum } = input;
  const checksumHeader = checksum ? S3_CHECKSUM_HEADERS[checksum.hashAlgorithm] : undefined;
  const headers: Record<string, string> = {};

  if (contentType != null) headers["content-type"] = contentType;
  if (contentLength != null) headers["content-length"] = String(contentLength);
  if (checksum && checksumHeader) headers[checksumHeader] = base64FromHex(checksum.hashHex);

  return { headers, unhoistable: checksumHeader ? [checksumHeader] : [] };
}

export const toStoredObject = (key: string, source: S3ObjectMetadata): StoredObject => ({
  key,
  size: source.ContentLength ?? source.Size ?? 0,
  contentType: source.ContentType,
  etag: source.ETag,
  lastModified: source.LastModified?.toISOString(),
  metadata: source.Metadata,
  checksum: checksumFrom(source),
});

export const toRange = (range?: GetObjectOptions["range"]): string | undefined =>
  range ? `bytes=${range.start}-${range.end ?? ""}` : undefined;

export const expiresAt = (from: Date, seconds: number): string =>
  new Date(from.getTime() + seconds * 1000).toISOString();
