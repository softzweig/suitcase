import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

/**
 * Creates an `S3Client` configured for {@link S3StorageBucket}.
 *
 * The SDK defaults to `requestChecksumCalculation: "WHEN_SUPPORTED"`, which adds
 * a CRC32 to every `PutObject`. A presigned URL then has to sign that header,
 * and because the digest was computed over an empty body the client can never
 * reproduce it. Pinning `"WHEN_REQUIRED"` limits checksums to the requests that
 * explicitly ask for one, which is what the adapter's callers do.
 */
export const createS3Client = (config: S3ClientConfig): S3Client =>
  new S3Client({ ...config, requestChecksumCalculation: "WHEN_REQUIRED" });
