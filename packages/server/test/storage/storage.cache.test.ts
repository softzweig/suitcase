import type { KVStore } from "@softzweig/suitcase-core/utils";
import { describe, expect, it, test } from "vitest";
import type {
  CreateDownloadUrlInput,
  PresignedRequest,
  StorageBucket,
} from "../../src/storage/index.js";
import { CachedDownloadStorageBucket } from "../../src/storage/storage.cache.js";

const createStore = (): {
  readonly store: KVStore;
  readonly values: Map<string, string>;
  readonly ttls: Map<string, number | undefined>;
} => {
  const values = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();

  return {
    values,
    ttls,
    store: {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value, ttlSeconds) => {
        values.set(key, value);
        ttls.set(key, ttlSeconds);
      },
      delete: async (key) => {
        values.delete(key);
      },
    },
  };
};

/** The single key an in-memory store holds, asserting there is exactly one. */
const onlyKey = (values: Map<string, string>): string => {
  const [key] = values.keys();

  if (key === undefined) throw new Error("expected a cached entry");

  return key;
};

/** A bucket that signs a URL expiring `ttl` seconds from now, defaulting to the request. */
const createDecorated = (
  ttl: (input: CreateDownloadUrlInput) => number = (input) => input.expiresInSeconds,
) => {
  const calls: CreateDownloadUrlInput[] = [];

  const bucket: StorageBucket = {
    getName: () => "suitcase-uploads",
    getPublicUrl: () => null,
    put: () => Promise.reject(new Error("unused")),
    get: () => Promise.reject(new Error("unused")),
    head: () => Promise.reject(new Error("unused")),
    remove: () => Promise.reject(new Error("unused")),
    copy: () => Promise.reject(new Error("unused")),
    list: () => Promise.reject(new Error("unused")),
    createUploadUrl: () => Promise.reject(new Error("unused")),
    createDownloadUrl: async (input) => {
      calls.push(input);

      return {
        url: `https://cdn.example.com/${input.key}?signature=${calls.length}`,
        method: "GET",
        expiresAt: new Date(Date.now() + ttl(input) * 1000).toISOString(),
      } satisfies PresignedRequest;
    },
  };

  return { bucket, calls };
};

const request: CreateDownloadUrlInput = { key: "assets/a.png", expiresInSeconds: 300 };

type CacheOptions = Partial<{
  createKey: (bucket: StorageBucket, digest: string) => string;
  shouldCache: (input: CreateDownloadUrlInput) => boolean;
}>;

const createCached = (store: KVStore, bucket: StorageBucket, options: CacheOptions = {}) =>
  new CachedDownloadStorageBucket({ cache: store, decorated: bucket, ...options });

describe("CachedDownloadStorageBucket", () => {
  describe("createDownloadUrl", () => {
    it("signs once and reuses the cached URL", async () => {
      const { store } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      const first = await cached.createDownloadUrl(request);
      const second = await cached.createDownloadUrl(request);

      expect(second).toEqual(first);
      expect(calls).toHaveLength(1);
    });

    it("signs again once the cached URL is past half its lifetime", async () => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      await cached.createDownloadUrl(request);

      for (const [key, value] of values) {
        const parsed = JSON.parse(value) as { expiresAt: string };
        parsed.expiresAt = new Date(Date.now() + 1000).toISOString();
        values.set(key, JSON.stringify(parsed));
      }

      await cached.createDownloadUrl(request);

      expect(calls).toHaveLength(2);
    });

    it("keys entries by the request options", async () => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      await cached.createDownloadUrl(request);
      await cached.createDownloadUrl({
        ...request,
        responseContentDisposition: "attachment",
      });

      expect(calls).toHaveLength(2);
      expect(values.size).toBe(2);
    });

    it("skips the cache below a second of ttl", async () => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      await cached.createDownloadUrl({ key: "assets/a.png", expiresInSeconds: 1 });
      await cached.createDownloadUrl({ key: "assets/a.png", expiresInSeconds: 1 });

      expect(calls).toHaveLength(2);
      expect(values.size).toBe(0);
    });

    it("does not cache a URL that is shorter than the margin", async () => {
      const { store, values } = createStore();
      // 100s of lifetime leaves nothing once the 150s margin is subtracted.
      const { bucket } = createDecorated(() => 100);

      await createCached(store, bucket).createDownloadUrl(request);

      expect(values.size).toBe(0);
    });

    it("keeps a hit usable for at least half its window", async () => {
      const { store } = createStore();
      const { bucket } = createDecorated(() => 204);
      const cached = createCached(store, bucket);

      const first = await cached.createDownloadUrl(request);
      const second = await cached.createDownloadUrl(request);

      expect(second).toEqual(first);
      expect(Date.parse(second.expiresAt) - Date.now()).toBeGreaterThanOrEqual(150_000);
    });

    it("stores the entry for exactly the remaining fresh window", async () => {
      const { store, ttls } = createStore();
      const { bucket } = createDecorated();

      await createCached(store, bucket).createDownloadUrl(request);

      const [ttl] = [...ttls.values()];
      if (ttl === undefined) throw new Error("expected a cached ttl");

      // 300s requested, so the entry may live for the 150s half-life, minus elapsed.
      expect(ttl).toBeGreaterThanOrEqual(149);
      expect(ttl).toBeLessThanOrEqual(150);
    });

    it("keeps entries apart by requested ttl", async () => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      await cached.createDownloadUrl(request);
      await cached.createDownloadUrl({ ...request, expiresInSeconds: 600 });

      expect(calls).toHaveLength(2);
      expect(values.size).toBe(2);
    });

    it("keeps the signed headers across the cache round-trip", async () => {
      const { store } = createStore();
      const { bucket } = createDecorated();
      const withHeaders: StorageBucket = {
        ...bucket,
        createDownloadUrl: async (input) => ({
          ...(await bucket.createDownloadUrl(input)),
          headers: { "x-signed": "abc" },
        }),
      };
      const cached = createCached(store, withHeaders);

      const first = await cached.createDownloadUrl(request);
      const second = await cached.createDownloadUrl(request);

      expect(second).toEqual(first);
      expect(second.headers).toEqual({ "x-signed": "abc" });
    });

    test.for([
      { label: "a schema mismatch", raw: '{"url":"nope"}' },
      { label: "malformed JSON", raw: "not json" },
    ])("re-signs when the cache holds $label", async ({ raw }) => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket);

      await cached.createDownloadUrl(request);
      values.set(onlyKey(values), raw);

      await cached.createDownloadUrl(request);

      expect(calls).toHaveLength(2);
    });

    it("degrades to signing when the cache is unavailable", async () => {
      const unavailable: KVStore = {
        get: () => Promise.reject(new Error("cache down")),
        set: () => Promise.reject(new Error("cache down")),
        delete: () => Promise.reject(new Error("cache down")),
      };
      const { bucket, calls } = createDecorated();

      const url = await createCached(unavailable, bucket).createDownloadUrl(request);

      expect(url.url).toContain("signature=1");
      expect(calls).toHaveLength(1);
    });

    it("still returns the URL when only the write fails", async () => {
      const readOnly: KVStore = {
        get: async () => null,
        set: () => Promise.reject(new Error("cache down")),
        delete: async () => undefined,
      };
      const { bucket, calls } = createDecorated();

      const url = await createCached(readOnly, bucket).createDownloadUrl(request);

      expect(url.url).toContain("signature=1");
      expect(calls).toHaveLength(1);
    });

    it("names entries after the bucket and a digest by default", async () => {
      const { store, values } = createStore();
      const { bucket } = createDecorated();

      await createCached(store, bucket).createDownloadUrl(request);

      expect(onlyKey(values)).toMatch(/^suitcase-uploads\/[a-f0-9]{64}$/);
    });

    it("lets the caller override the key builder", async () => {
      const { store, values } = createStore();
      const { bucket } = createDecorated();
      const createKey = (_bucket: StorageBucket, digest: string) => `custom/${digest}`;

      await createCached(store, bucket, { createKey }).createDownloadUrl(request);

      expect(onlyKey(values)).toMatch(/^custom\/[a-f0-9]{64}$/);
    });

    it("skips the cache when the filter rejects the request", async () => {
      const { store, values } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket, { shouldCache: () => false });

      await cached.createDownloadUrl(request);
      await cached.createDownloadUrl(request);

      expect(calls).toHaveLength(2);
      expect(values.size).toBe(0);
    });

    test.for([
      { label: "an asset key", key: "assets/a.png", expected: 1 },
      { label: "another prefix", key: "avatars/a.png", expected: 2 },
    ])("caches only what the filter accepts: $label", async ({ key, expected }) => {
      const { store } = createStore();
      const { bucket, calls } = createDecorated();
      const cached = createCached(store, bucket, {
        shouldCache: (input) => input.key.startsWith("assets/"),
      });

      await cached.createDownloadUrl({ ...request, key });
      await cached.createDownloadUrl({ ...request, key });

      expect(calls).toHaveLength(expected);
    });
  });

  it("delegates every operation to the decorated bucket", async () => {
    const seen: string[] = [];
    const preset: PresignedRequest = {
      url: "https://cdn.example.com/x",
      method: "GET",
      expiresAt: new Date().toISOString(),
    };
    const bucket: StorageBucket = {
      getName: () => {
        seen.push("getName");
        return "suitcase-uploads";
      },
      getPublicUrl: () => {
        seen.push("getPublicUrl");
        return null;
      },
      put: async () => {
        seen.push("put");
        return { key: "k" };
      },
      get: async () => {
        seen.push("get");
        return null;
      },
      head: async () => {
        seen.push("head");
        return null;
      },
      remove: async () => {
        seen.push("remove");
      },
      copy: async () => {
        seen.push("copy");
      },
      list: async () => {
        seen.push("list");
        return { objects: [] };
      },
      createUploadUrl: async () => {
        seen.push("createUploadUrl");
        return preset;
      },
      createDownloadUrl: async () => {
        seen.push("createDownloadUrl");
        return preset;
      },
    };

    const cached = createCached(createStore().store, bucket);

    cached.getName();
    cached.getPublicUrl("k");
    await cached.put({ key: "k", body: new Uint8Array(), contentType: "text/plain" });
    await cached.get("k");
    await cached.head("k");
    await cached.remove("k");
    await cached.copy({ sourceKey: "a", destinationKey: "b" });
    await cached.list();
    await cached.createUploadUrl({ key: "k", expiresInSeconds: 60 });
    await cached.createDownloadUrl({ key: "k", expiresInSeconds: 60 });

    expect(seen).toEqual([
      "getName",
      "getPublicUrl",
      "put",
      "get",
      "head",
      "remove",
      "copy",
      "list",
      "createUploadUrl",
      // The default key builder reads the bucket name to prefix the digest.
      "getName",
      "createDownloadUrl",
    ]);
  });
});
