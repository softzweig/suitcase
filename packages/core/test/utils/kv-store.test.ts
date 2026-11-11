import { describe, expect, it, test } from "vitest";
import { z } from "zod";

import { type KVStore, TypedKVStore } from "../../src/utils/kv-store.js";

const Asset = z.object({ id: z.string(), size: z.number() });

type Entry = { readonly id: string; readonly size: number };

const createStore = (initial: Readonly<Record<string, string>> = {}) => {
  const values = new Map(Object.entries(initial));
  const calls: string[] = [];

  const store: KVStore = {
    get: async (key) => {
      calls.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    set: async (key, value, ttlSeconds) => {
      calls.push(`set:${key}:${ttlSeconds ?? "-"}`);
      values.set(key, value);
    },
    delete: async (key) => {
      calls.push(`delete:${key}`);
      values.delete(key);
    },
  };

  return { kv: new TypedKVStore(store), values, calls };
};

const asset: Entry = { id: "a_1", size: 1024 };

describe("TypedKVStore", () => {
  it("round-trips a value", async () => {
    const { kv } = createStore();

    await kv.setJson(Asset, "asset:a_1", asset);

    await expect(kv.getJson(Asset, "asset:a_1")).resolves.toEqual(asset);
  });

  it("stores JSON, not a live object", async () => {
    const { kv, values } = createStore();

    await kv.setJson(Asset, "asset:a_1", asset);

    expect(values.get("asset:a_1")).toBe(JSON.stringify(asset));
  });

  it("returns null for a missing key", async () => {
    const { kv } = createStore();

    await expect(kv.getJson(Asset, "asset:missing")).resolves.toBeNull();
  });

  it("forwards the ttl to the backend", async () => {
    const { kv, calls } = createStore();

    await kv.setJson(Asset, "asset:a_1", asset, 60);

    expect(calls).toContain("set:asset:a_1:60");
  });

  it("forwards delete", async () => {
    const { kv, values } = createStore({ "asset:a_1": JSON.stringify(asset) });

    await kv.delete("asset:a_1");

    expect(values.has("asset:a_1")).toBe(false);
  });

  test.for([
    { label: "an entry that no longer matches the schema", raw: '{"id":"a_1"}' },
    { label: "malformed JSON", raw: "not json" },
    { label: "an empty string", raw: "" },
  ])("throws for $label, without deleting it", async ({ raw }) => {
    const { kv, values } = createStore({ "asset:a_1": raw });

    await expect(kv.getJson(Asset, "asset:a_1")).rejects.toThrow();
    expect(values.get("asset:a_1")).toBe(raw);
  });

  it("throws and writes nothing when the schema rejects the value", async () => {
    const { kv, values, calls } = createStore();

    await expect(
      kv.setJson(Asset, "asset:a_1", { id: "a_1", size: "big" } as unknown as Entry),
    ).rejects.toThrow();

    expect(values.has("asset:a_1")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("round-trips ISO timestamps", async () => {
    const Entry = z.object({ key: z.string(), lastModified: z.iso.datetime() });
    const { kv } = createStore();
    const lastModified = "2026-11-11T10:00:00.000Z";

    await kv.setJson(Entry, "object:a_1", { key: "a_1", lastModified });

    await expect(kv.getJson(Entry, "object:a_1")).resolves.toEqual({
      key: "a_1",
      lastModified,
    });
  });
});
