import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

import { StorageError, StorageErrorCode } from "@softzweig/suitcase-server";

/**
 * Creates an `S3Client` configured for {@link S3StorageBucket}.
 *
 * The SDK defaults to `requestChecksumCalculation: "WHEN_SUPPORTED"`, which adds
 * a CRC32 to every `PutObject`. A presigned URL then has to sign that checksum,
 * and because the presigner sees no body the digest is of an empty payload, so
 * no upload can satisfy it. Pinning `"WHEN_REQUIRED"` limits checksums to the
 * requests that explicitly ask for one, which is what the adapter's callers do.
 */
export const createS3Client = (config: S3ClientConfig): S3Client =>
  new S3Client({ ...config, requestChecksumCalculation: "WHEN_REQUIRED" });

/**
 * Fails when a client would produce presigned uploads that cannot be satisfied.
 *
 * Configuration is only readable asynchronously, so this runs before the first
 * presign rather than in the constructor. Only presigned uploads are affected: a
 * client that attaches its own checksum still uploads objects correctly.
 *
 * @throws {StorageError} When the client does not pin `"WHEN_REQUIRED"`.
 */
export async function assertPresignableClient(client: S3Client): Promise<void> {
  if ((await client.config.requestChecksumCalculation()) === "WHEN_REQUIRED") return;

  throw new StorageError(
    StorageErrorCode.UNKNOWN,
    `S3 client must set requestChecksumCalculation to "WHEN_REQUIRED"; use createS3Client() instead of new S3Client()`,
  );
}
