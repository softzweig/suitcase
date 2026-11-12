import {
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { StorageBucket } from "@softzweig/suitcase-server/storage";
import { GenericContainer, Wait } from "testcontainers";

import { createS3Client, S3StorageBucket } from "../../src/index.js";

const ACCESS_KEY = "suitcase-access-key";
const SECRET_KEY = "suitcase-secret-key";

/**
 * The S3 implementation the integration suite runs against. Everything below is
 * vendor-neutral, so moving backends means editing this object.
 *
 * RustFS validates SigV4 signatures and object checksums, which is what makes
 * the suite meaningful: a presigned upload is accepted or rejected by a real
 * server. Pinned so an upstream release cannot change behavior under CI.
 *
 * @note MinIO is the reference choice, but unusable here: the community repo is
 * archived (Apr 2026), it ships source-only, and its public images are gone
 * (`minio/minio` is 404 on Docker Hub, Quay needs auth). LocalStack would need a
 * paid token.
 */
const BACKEND = {
  image: "rustfs/rustfs:1.0.5",
  port: 9000,
  healthPath: "/health",
  environment: { RUSTFS_ACCESS_KEY: ACCESS_KEY, RUSTFS_SECRET_KEY: SECRET_KEY },
} as const;

/** Cold runners have to pull the image before the container is ready. */
export const STARTUP_TIMEOUT_MS = 120_000;

export interface TestStorage {
  readonly bucket: StorageBucket;
  /** Deletes every object, so each test starts from an empty bucket. */
  empty(): Promise<void>;
  stop(): Promise<void>;
}

const emptyBucket = async (s3: S3Client, bucket: string): Promise<void> => {
  const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  await Promise.all(
    (Contents ?? []).map(({ Key }) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }))),
  );
};

/** Starts the backend in a container and hands back a bucket bound to it. */
export const startStorageServer = async (bucketName = "suitcase-uploads"): Promise<TestStorage> => {
  const container = await new GenericContainer(BACKEND.image)
    .withEnvironment(BACKEND.environment)
    .withExposedPorts(BACKEND.port)
    .withWaitStrategy(
      Wait.forHttp(BACKEND.healthPath, BACKEND.port).withStartupTimeout(STARTUP_TIMEOUT_MS),
    )
    .start();

  const s3 = createS3Client({
    endpoint: `http://${container.getHost()}:${container.getMappedPort(BACKEND.port)}`,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });

  await s3.send(new CreateBucketCommand({ Bucket: bucketName }));

  return {
    bucket: await S3StorageBucket.create({ s3, name: bucketName }),
    empty: () => emptyBucket(s3, bucketName),
    stop: async () => {
      await container.stop();
    },
  };
};
