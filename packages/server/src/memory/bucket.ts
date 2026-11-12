import { BucketAccessPolicy } from "../storage/storage.access-policy.js";
import type { StorageBucket } from "../storage/storage.bucket.js";
import { StorageError, StorageErrorCode } from "../storage/storage.errors.js";
import { readBytes } from "../storage/storage.helpers.js";
import type {
  ByteStream,
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
} from "../storage/storage.operations.js";

/** An object held in memory, including the bytes the getter streams. */
type Stored = StoredObject & { readonly body: Uint8Array };

/** A immutable record of a presigned request issued by a memory-bucket. */
type IssuedRequest = {
  readonly key: string;
  readonly method: string;
  readonly expiresAt: number;
};

export interface MemoryBucketOptions {
  /** Defaults to private, which makes {@link MemoryBucket.getPublicUrl} return null. */
  readonly access?: BucketAccessPolicy;
}

/** How many objects a page holds when the caller does not ask for a size. */
const DEFAULT_PAGE_SIZE = 1_000;

const SCHEME = "memory://";

/** A bucket holding objects in memory. */
export const createMemoryBucket = (name: string, options: MemoryBucketOptions = {}) =>
  new MemoryBucket(name, options.access);

/**
 * A bucket config for a service context, so a bucket and its access policy are
 * created together and cannot disagree.
 */
export const createMemoryBucketConfig = (name: string, options: MemoryBucketOptions = {}) => ({
  access: options.access ?? BucketAccessPolicy.PRIVATE,
  storage: createMemoryBucket(name, options),
});

const toMetadata = ({ body, ...object }: Stored): StoredObject => object;

/**
 * A {@link StorageBucket} that keeps objects in memory: the option to reach for
 * when an S3 container is overkill, a local dev server, or a test that needs
 * real storage behaviour without infrastructure.
 *
 * **Not a production store, by construction: one process holds everything, so
 * objects end with the process, other instances never see them, and uploads are
 * bounded only by memory. A deployment that wants no S3 needs a durable local
 * adapter of its own, in a package free to use the filesystem.**
 *
 * Objects live only as long as the instance does, and nothing here verifies what
 * it stores: {@link MemoryBucket.put} records the metadata it is given, so a
 * caller can model a backend that trusts its client. Checking claims is the
 * domain's job, and it happens after the fact.
 *
 * Presigned URLs are issued and served by this same instance, so a client's
 * upload or download can be played out without an HTTP server:
 *
 * @example
 * ```ts
 * const request = await bucket.createUploadUrl({ key, expiresInSeconds: 60 });
 * await bucket.putPresigned(request, bytes);
 * ```
 */
export class MemoryBucket implements StorageBucket {
  private readonly objects = new Map<string, Stored>();

  /** What this bucket has handed out a URL for, so a replay can be checked. */
  private readonly issued = new Map<string, IssuedRequest>();

  constructor(
    private readonly name: string,
    private readonly access: BucketAccessPolicy = BucketAccessPolicy.PRIVATE,
  ) {}

  getName(): string {
    return this.name;
  }

  getPublicUrl(key: string): string | null {
    if (this.access !== BucketAccessPolicy.PUBLIC) return null;
    return `${SCHEME}${this.name}/${key}`;
  }

  async put({
    key,
    body,
    contentType,
    checksum,
    metadata,
  }: PutObjectInput): Promise<PutObjectResult> {
    const bytes = await readBytes(body);

    this.objects.set(key, {
      key,
      body: bytes,
      size: bytes.byteLength,
      ...(!contentType ? {} : { contentType }),
      ...(!checksum ? {} : { checksum }),
      ...(!metadata ? {} : { metadata }),
    });

    return { key };
  }

  async get(key: string, options: GetObjectOptions = {}): Promise<GetObjectResult | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;

    const { start = 0, end } = options.range ?? {};
    const body = stored.body.slice(start, end == null ? undefined : end + 1);

    return {
      ...toMetadata(stored),
      size: body.byteLength,
      body: (async function* () {
        yield body;
      })(),
    };
  }

  async head(key: string): Promise<StoredObject | null> {
    const stored = this.objects.get(key);
    return stored ? toMetadata(stored) : null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async copy({ sourceKey, destinationKey, contentType }: CopyObjectInput): Promise<void> {
    const source = this.objects.get(sourceKey);
    if (!source) {
      throw new StorageError(StorageErrorCode.NOT_FOUND, `Object ${sourceKey} not found`);
    }

    this.objects.set(destinationKey, {
      ...source,
      key: destinationKey,
      ...(!contentType ? {} : { contentType }),
    });
  }

  async list({ prefix, cursor, limit }: ListObjectsOptions = {}): Promise<ListObjectsResult> {
    const matching = [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix ?? ""))
      .sort((left, right) => (left.key < right.key ? -1 : 1))
      .filter((object) => cursor == null || object.key > cursor);

    const page = matching.slice(0, limit ?? DEFAULT_PAGE_SIZE);
    const lastKey = page.at(-1)?.key;

    return {
      objects: page.map(toMetadata),
      ...(matching.length > page.length && lastKey != null ? { nextCursor: lastKey } : {}),
    };
  }

  /** Issues an upload URL, pinned to the content type the client declared. */
  async createUploadUrl({ key, expiresInSeconds, contentType }: CreateUploadUrlInput) {
    return this.issue("PUT", key, expiresInSeconds, {
      ...(contentType == null ? {} : { "content-type": contentType }),
    });
  }

  /**
   * Issues a download URL. The `responseContentDisposition` the port accepts has
   * no response to apply to here.
   */
  async createDownloadUrl({ key, expiresInSeconds }: CreateDownloadUrlInput) {
    return this.issue("GET", key, expiresInSeconds);
  }

  /** The backend's part of a client's PUT: authorize the URL, then store what it sent. */
  async putPresigned(request: PresignedRequest, body: Uint8Array | ByteStream) {
    const { headers = {} } = request;

    return this.put({
      key: this.authorize(request, "PUT"),
      body: await readBytes(body),
      contentType: headers["content-type"] ?? "application/octet-stream",
    });
  }

  /** The backend's part of a client's GET: authorize the URL, then read the object. */
  async getPresigned(request: PresignedRequest): Promise<GetObjectResult | null> {
    return this.get(this.authorize(request, "GET"));
  }

  /**
   * Remembers a URL and returns the request carrying it.
   *
   * The address names the object and nothing else: the method and the moment it
   * lapses travel in {@link PresignedRequest} itself, so there is nothing to
   * encode in, or decode out of, the string.
   */
  private issue(
    method: PresignedRequest["method"],
    key: string,
    expiresInSeconds: number,
    headers: Readonly<Record<string, string>> = {},
  ): PresignedRequest {
    const url = `${SCHEME}${this.name}/${key}`;
    const expiresAt = Date.now() + expiresInSeconds * 1_000;

    this.issued.set(url, { key, method, expiresAt });

    return {
      url,
      method,
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /**
   * Refuses a URL this bucket never issued, one issued for another method, or
   * one whose moment has passed, and returns the key it authorizes.
   */
  private authorize(request: PresignedRequest, method: PresignedRequest["method"]): string {
    const issued = this.issued.get(request.url);

    if (!issued || issued.method !== method || request.method !== method) {
      throw new StorageError(
        StorageErrorCode.FORBIDDEN,
        `No ${method} URL was issued for ${request.url}`,
      );
    }

    if (issued.expiresAt <= Date.now()) {
      throw new StorageError(StorageErrorCode.FORBIDDEN, "Presigned request has expired");
    }

    return issued.key;
  }
}
