import { ServiceError } from "../services/service.error.js";
import type { BucketConfig } from "./storage.bucket.js";

export const UPLOAD_BUCKET_KEY = "upload" as const;

export type SuitcaseBuckets = Readonly<Record<string, BucketConfig>> & {
  readonly [UPLOAD_BUCKET_KEY]: BucketConfig;
};

export class SuitcaseBucketRegistry<T extends SuitcaseBuckets = SuitcaseBuckets> {
  constructor(readonly buckets: T) {}

  getBucket<K extends keyof T>(key: K): T[K] {
    const bucket = this.buckets[key];
    ServiceError.assertPrecondition(bucket, "Bucket not found", { key });
    return bucket;
  }

  getUploadBucket() {
    return this.getBucket(UPLOAD_BUCKET_KEY);
  }
}
