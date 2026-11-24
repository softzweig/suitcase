import { createS3Client, S3StorageBucket } from "@softzweig/suitcase-s3";
import type { InferSuitcaseClient } from "@softzweig/suitcase-server";
import { BucketAccessPolicy, type BucketConfig, Suitcase } from "@softzweig/suitcase-server";
import { z } from "zod";
import { ASSETS_BUCKET, S3_ENDPOINT, UPLOADS_BUCKET } from "../s3";

/** What the browser talks to: the same definition, from the client's side. */
export type GalleryClient = InferSuitcaseClient<typeof definition>;

const s3 = createS3Client({
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "S3RVER",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "S3RVER",
  },
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  region: process.env.S3_REGION ?? "us-east-1",
});

const bucket = async (name: string): Promise<BucketConfig> => ({
  access: BucketAccessPolicy.PRIVATE,
  storage: await S3StorageBucket.create({ name, s3 }),
});

/**
 * One kind: photos anyone may look at, uploaded by the signed-in user.
 *
 * `ownedBy` reads the execution context instead of trusting the client, which is why the context
 * is declared as a `userId` and supplied per request in `server.ts`.
 */
export const definition = Suitcase.withBuckets({
  upload: await bucket(UPLOADS_BUCKET),
  [ASSETS_BUCKET]: await bucket(ASSETS_BUCKET),
})
  .withContext<{ userId: string }>()
  .withResources(({ owner, read, resource }) => {
    const user = owner({
      authorize: () => true,
      schema: z.object({ userId: z.string() }),
    });

    return {
      photo: resource("photo", {
        bucket: ASSETS_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          maxSize: "20 MB",
          mimeTypes: ["image/gif", "image/jpeg", "image/png", "image/webp"],
          ownedBy: ({ execution }) => ({ userId: execution.userId }),
        }),
      }),
    };
  });
