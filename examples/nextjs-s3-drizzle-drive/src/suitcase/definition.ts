import { createS3Client, S3StorageBucket } from "@softzweig/suitcase-s3";
import type { InferSuitcaseClient } from "@softzweig/suitcase-server";
import { BucketAccessPolicy, type BucketConfig, Suitcase } from "@softzweig/suitcase-server";
import { z } from "zod";
import { ASSETS_BUCKET, S3_ENDPOINT, UPLOADS_BUCKET } from "../s3";

/** What the browser talks to: the same definition, from the client's side. */
export type DriveClient = InferSuitcaseClient<typeof definition>;

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
 * One kind: any file, owned by the signed-in user and readable by nobody else.
 *
 * `expose` is where the second half is enforced. It is handed every resource the caller asked
 * for and answers with the ids that caller may have, so another user's id resolves to
 * `NOT_FOUND` rather than to a link.
 */
export const definition = Suitcase.withBuckets({
  upload: await bucket(UPLOADS_BUCKET),
  [ASSETS_BUCKET]: await bucket(ASSETS_BUCKET),
})
  .withContext<{ readonly userId: string }>()
  .withResources(({ owner, read, resource }) => {
    const user = owner({
      authorize: () => true,
      schema: z.object({ userId: z.string() }),
    });

    return {
      file: resource("file", {
        bucket: ASSETS_BUCKET,
        owner: user,
        read: read({
          expose: ({ execution, requested }) =>
            requested.filter(({ owner: of }) => of.userId === execution.userId).map(({ id }) => id),
        }),
        upload: user.upload({
          maxSize: "50 MB",
          ownedBy: ({ execution }) => ({ userId: execution.userId }),
        }),
      }),
    };
  });
