import type { z } from "zod";

/**
 * Raw key/value storage.
 *
 * Implement this to wire a backend — Redis, DynamoDB, Cloudflare KV, a Map. The
 * contract is strings in, strings out, and it knows nothing about schemas, so
 * every adapter stays a few lines long.
 */
export interface KVStore {
  /** Raw value, or `null` when the key is absent or expired. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

const encode = async (value: unknown) => JSON.stringify(value);
const decode = async (raw: string) => JSON.parse(raw);

export class TypedKVStore implements KVStore {
  constructor(readonly store: KVStore) {}

  static from(store: KVStore): TypedKVStore {
    if (store instanceof TypedKVStore) return store;
    return new TypedKVStore(store);
  }

  get(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.store.set(key, value, ttlSeconds);
  }

  delete(key: string): Promise<void> {
    return this.store.delete(key);
  }

  /**
   * Reads and validates a JSON value; `null` only when the key is absent.
   *
   * Malformed JSON and entries that no longer match `schema` throw instead of
   * being reported as absent, so a corrupted entry cannot masquerade as a cache
   * miss. Callers that prefer to degrade — a cache, for instance — catch here.
   *
   * @throws {SyntaxError} When the stored value is not valid JSON.
   * @throws {z.ZodError} When the decoded value does not match `schema`.
   */
  async getJson<T extends z.ZodType>(schema: T, key: string): Promise<z.infer<T> | null> {
    const raw = await this.get(key);
    if (raw === null) return null;

    return schema.parse(await decode(raw));
  }

  /**
   * Validates and encodes `value` before writing it; nothing is written on
   * failure, and the failure is raised to the caller.
   *
   * @throws {z.ZodError} When `value` does not match `schema`.
   * @throws {TypeError} When the value has no JSON representation.
   */
  async setJson<T extends z.ZodType>(
    schema: T,
    key: string,
    value: z.infer<T>,
    ttlSeconds?: number,
  ): Promise<void> {
    const encoded = await encode(schema.parse(value));

    if (encoded === undefined) {
      throw new TypeError(`value for "${key}" is not JSON-serializable`);
    }

    await this.set(key, encoded, ttlSeconds);
  }
}
