/**
 * Determines the access policy for a storage bucket, used to guage whether
 * assets within that bucket should be authorized upon reads or whether they
 * can be accessed without authorization.
 *
 * Essentially the idea behind the access policy is a potential split between
 * different buckets, say S3 buckets, whose contents may have varying access
 * requirements. User assets, such as profile pictures may have "public" as
 * a access policy, whereas private assets, such as user documents, may have
 * "private" as their access policy.
 *
 * The advantage of this approach is that public resources don't have to go
 * through authorization funnels, and eventually may not need signed URLs for
 * access in a S3 context, and allow for global CDN caching and serve. This can
 * save performance and storage costs drastically.
 *
 * @note The reason why this lives in storage.ts instead of the core, is that
 * this is a very implementation-specific concern related to storage buckets,
 * which are only relevant on the server-level, and not in the core application
 * logic.
 *
 * @human
 */
export type BucketAccessPolicy = (typeof BucketAccessPolicy)[keyof typeof BucketAccessPolicy];

export const BucketAccessPolicy = Object.freeze({
  PUBLIC: "public",
  PRIVATE: "private",
});
