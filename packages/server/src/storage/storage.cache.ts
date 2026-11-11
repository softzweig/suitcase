import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { type KVStore, TypedKVStore } from "@softzweig/suitcase-core/utils";
import z from "zod";
import type { StorageBucket } from "./storage.bucket.js";
import type {
  CopyObjectInput,
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  GetObjectOptions,
  GetObjectResult,
  ListObjectsOptions,
  ListObjectsResult,
  PresignedRequest,
  PutObjectInput,
  PutObjectResult,
  StoredObject,
} from "./storage.operations.js";

/** A presigned download as it looks after a JSON round-trip. */
const CachedDownloadSchema: z.ZodType<PresignedRequest> = z.object({
  url: z.url(),
  method: z.literal("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  expiresAt: z.iso.datetime(),
});

/**
 * A cached storage bucket that wraps another storage bucket and caches download URLs.
 *
 * This helps reduce the number of times download URLs need to be signed by the
 * underlying storage bucket, drastically reducing operating costs.
 *
 * #### Why caching matters
 * Especially hosts such as `Cloudflare R2` profit from cached distribution, because
 * downloadable URLs can be reused without having to re-sign them for every request.
 * Meaning we can serve repeated download requests and cache them in the edge network,
 * making even private content efficiently accessible through cached URLs.
 * This also heavily reduces churn in the client, as browsers can efficiently cache
 * served content locally without repeatedly fetching new signed URLs, surviving
 * network interruptions and browser refreshes. The effectiveness was proven in the
 * origin project that used this approach, [stratforge.gg](https://stratforge.gg),
 * from wherein the caching strategy was successfully applied to serve content
 * efficiently and reduced operational costs drastically (~10x).
 *
 * #### Security concerns
 * The biggest and potentially primary security concern is the exposure of signed download URLs.
 * If these URLs are cached and distributed widely, they could be used by unauthorized parties
 * to access private content until they expire. Therefore, it is crucial to ensure that the
 * caching strategy respects the intended access controls and that URLs have appropriate
 * expiration times to minimize the risk of unauthorized access.
 *
 * Two different devices would share the same download URL, but since expiration is checked
 * within the caching determination, the security concern is **minor**. Underlying KVCaches
 * could potentially even cryptographically secure the cached URLs, adding an extra layer
 * of security, in case e.g. Redis is an externalized cache outside of a private network.
 *
 * #### Cache admission and freshness
 * A request reaches the cache only when `shouldCache` accepts it; a rejected request is delegated
 * straight to the decorated bucket, without any read or write. Requests whose margin, half of
 * `expiresInSeconds`, floored, is below one second are not cached at all.
 *
 * Entries are keyed deterministically: SHA-256 over the object key, the requested TTL and the
 * sorted, defined request options, rendered through `createKey`. Identical requests therefore
 * resolve to the same entry, and any differing option resolves to a different one.
 *
 * A stored entry is served only while the URL's own `expiresAt` is further away than the margin.
 * The KV TTL is written as exactly that remaining window, so the entry disappears precisely when
 * the URL would stop satisfying the freshness requirement. The TTL is derived from the signed URL
 * rather than the requested duration, so an adapter that signs for less than asked can never
 * produce an over-long entry.
 *
 * @note If only certain download URLs need to be cached, the `shouldCache` function can be
 * used to selectively enable caching based on the request parameters, ensuring that
 * sensitive or unique URLs are not inadvertently stored in the cache.
 *
 * @note The caching key can be customized using the `createKey` function, allowing control over
 * how cache entries are named and organized, however not its digest creation by default.
 *
 * @human
 */
export class CachedDownloadStorageBucket implements StorageBucket {
  readonly cache: TypedKVStore;
  readonly decorated: StorageBucket;

  private readonly createKey: (bucket: StorageBucket, digest: string) => string;
  private readonly shouldCache: (input: CreateDownloadUrlInput) => boolean;

  constructor({
    cache,
    decorated,
    createKey = (bucket, digest) => `${bucket.getName()}/${digest}`,
    shouldCache = () => true,
  }: {
    cache: KVStore;
    decorated: StorageBucket;

    /**
     * Overrides how a cache entry is named.
     *
     * Defaults to `${bucket.getName()}/${digest}`, whereas the `digest` is a
     * hash of some request parameters, the key, and the expiration time.
     *
     * `bucket` is the storage bucket instance, which is the instance of
     * CachedDownloadStorageBucket, not the decorated one.
     *
     * @default "<bucket.getName()>/<digest>"
     */
    createKey?: (bucket: StorageBucket, digest: string) => string;

    /**
     * Decides whether a request may be cached at all.
     *
     * Runs before any cache lookup, so returning `false` delegates straight to
     * the decorated bucket. Useful for requests whose URLs must stay unique, or
     * that should never be persisted.
     *
     * @default () => true
     */
    shouldCache?: (input: CreateDownloadUrlInput) => boolean;
  }) {
    this.cache = TypedKVStore.from(cache);
    this.decorated = decorated;
    this.createKey = createKey;
    this.shouldCache = shouldCache;
  }

  /**
   * Epoch milliseconds until which a URL may be served from cache.
   *
   * The margin keeps a cached URL usable for a meaningful part of its window, so
   * a hit always leaves the caller at least half of what they asked for.
   */
  private static freshUntil(expiresAt: string, marginSeconds: number): number {
    return Date.parse(expiresAt) - marginSeconds * 1000;
  }

  getName(): string {
    return this.decorated.getName();
  }

  getPublicUrl(key: string): string | null {
    return this.decorated.getPublicUrl(key);
  }

  put(input: PutObjectInput): Promise<PutObjectResult> {
    return this.decorated.put(input);
  }

  get(key: string, options?: GetObjectOptions): Promise<GetObjectResult | null> {
    return this.decorated.get(key, options);
  }

  head(key: string): Promise<StoredObject | null> {
    return this.decorated.head(key);
  }

  remove(key: string): Promise<void> {
    return this.decorated.remove(key);
  }

  copy(input: CopyObjectInput): Promise<void> {
    return this.decorated.copy(input);
  }

  list(options?: ListObjectsOptions): Promise<ListObjectsResult> {
    return this.decorated.list(options);
  }

  createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedRequest> {
    return this.decorated.createUploadUrl(input);
  }

  /**
   * Signs a download URL, reusing a cached one while it still has half of its
   * lifetime left.
   *
   * Half is the margin: a cached URL is only handed out while the caller could
   * still use it for a meaningful part of their requested window.
   */
  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedRequest> {
    if (!this.shouldCache(input)) {
      return this.decorated.createDownloadUrl(input);
    }

    const { key, expiresInSeconds, ...options } = input;
    const margin = Math.floor(expiresInSeconds / 2);

    // Below a second of margin there is nothing worth caching.
    if (!Number.isFinite(margin) || margin < 1) {
      return this.decorated.createDownloadUrl(input);
    }

    const cacheKey = this.downloadCacheKey(key, expiresInSeconds, options);
    const cached = await this.cache.getJson(CachedDownloadSchema, cacheKey).catch(() => null);

    if (cached && CachedDownloadStorageBucket.freshUntil(cached.expiresAt, margin) > Date.now()) {
      return cached;
    }

    const signed = await this.decorated.createDownloadUrl(input);
    // Measured from the URL's own expiry, not the requested ttl: an adapter may
    // sign for less than asked, and the entry must never outlive the margin.
    const remainingTtl = Math.floor(
      (CachedDownloadStorageBucket.freshUntil(signed.expiresAt, margin) - Date.now()) / 1000,
    );

    if (remainingTtl > 0) {
      await this.cache
        .setJson(CachedDownloadSchema, cacheKey, signed, remainingTtl)
        .catch(() => null);
    }

    return signed;
  }

  /** Stable key over the request, so equivalent calls share an entry. */
  private downloadCacheKey(
    key: string,
    expiresInSeconds: number,
    options: Omit<CreateDownloadUrlInput, "key" | "expiresInSeconds">,
  ): string {
    const entries = Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([first], [second]) => first.localeCompare(second));
    const digest = bytesToHex(
      sha256(utf8ToBytes(JSON.stringify([key, expiresInSeconds, entries]))),
    );
    return this.createKey(this, digest);
  }
}
