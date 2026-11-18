import { describe, expect, it } from "vitest";

import { MemoryRepository, type MemoryStore } from "../../src/memory/index.js";
import { createMemoryRepositories } from "../support/memory.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A minimal entity, to exercise the generic repository on its own terms. */
type Note = { readonly id: string; readonly title: string; readonly pinned: boolean };

const createNotes = (createId?: () => string) => {
  const store: MemoryStore = new Map();

  return { store, notes: new MemoryRepository<Note>(store, "notes", createId) };
};

const givenNotes = async () => {
  const { notes } = createNotes();

  await notes.insert({ id: "n_1", title: "first", pinned: true });
  await notes.insert({ id: "n_2", title: "second", pinned: false });

  return notes;
};

describe("MemoryRepository", () => {
  describe("insert", () => {
    it("stores the row it returns", async () => {
      const { notes } = createNotes();
      const row: Note = { id: "n_1", title: "first", pinned: false };

      await expect(notes.insert(row)).resolves.toEqual(row);
      await expect(notes.findById("n_1")).resolves.toEqual(row);
    });

    it("generates a uuid when the insert omits one", async () => {
      const { notes } = createNotes();

      const row = await notes.insert({ title: "first", pinned: false });

      expect(row.id).toMatch(UUID_V4);
      await expect(notes.findById(row.id)).resolves.toEqual(row);
    });

    it("generates ids with the injected generator", async () => {
      const { notes } = createNotes(() => "n_fixed");

      await expect(notes.insert({ title: "first", pinned: false })).resolves.toMatchObject({
        id: "n_fixed",
      });
    });

    it("appends to the rows already stored", async () => {
      const notes = await givenNotes();

      await expect(notes.findMany({})).resolves.toHaveLength(2);
    });
  });

  describe("reads", () => {
    it("matches every field of the filter", async () => {
      const notes = await givenNotes();

      await expect(notes.findMany({ pinned: true, title: "first" })).resolves.toEqual([
        { id: "n_1", title: "first", pinned: true },
      ]);
      await expect(notes.findMany({ pinned: true, title: "second" })).resolves.toEqual([]);
    });

    it("treats an array as any-of", async () => {
      const notes = await givenNotes();

      await expect(notes.findMany({ id: ["n_1", "missing"] })).resolves.toEqual([
        { id: "n_1", title: "first", pinned: true },
      ]);
    });

    it("returns null when nothing matches", async () => {
      const notes = await givenNotes();

      await expect(notes.findOne({ title: "missing" })).resolves.toBeNull();
    });
  });

  describe("object filters", () => {
    /** An entity with object-valued fields, the way resources hold `owner` and `metadata`. */
    type Owned = {
      readonly id: string;
      readonly owner: Record<string, unknown>;
      readonly metadata: Record<string, unknown> | null;
    };

    const givenOwned = async () => {
      const store: MemoryStore = new Map();
      const owned = new MemoryRepository<Owned>(store, "owned");

      await owned.insert({
        id: "o_1",
        owner: { userId: "u_1", system: true },
        metadata: { tags: ["a"], folder: { id: "f" } },
      });
      await owned.insert({ id: "o_2", owner: { userId: "u_2" }, metadata: null });

      return owned;
    };

    it("matches an object field by value, not by instance", async () => {
      const owned = await givenOwned();

      await expect(
        owned.findOne({ owner: { userId: "u_1", system: true } }),
      ).resolves.toMatchObject({ id: "o_1" });
    });

    it("matches regardless of key order", async () => {
      const owned = await givenOwned();

      await expect(
        owned.findOne({ owner: { system: true, userId: "u_1" } }),
      ).resolves.toMatchObject({ id: "o_1" });
    });

    it("matches nested objects and arrays", async () => {
      const owned = await givenOwned();

      await expect(
        owned.findMany({ metadata: { folder: { id: "f" }, tags: ["a"] } }),
      ).resolves.toHaveLength(1);
      await expect(
        owned.findMany({ metadata: { folder: { id: "f" }, tags: ["b"] } }),
      ).resolves.toHaveLength(0);
    });

    it("treats an array of objects as any-of", async () => {
      const owned = await givenOwned();

      await expect(
        owned.findMany({ owner: [{ userId: "u_1", system: true }, { userId: "u_2" }] }),
      ).resolves.toHaveLength(2);
    });

    it("keeps null distinct from a missing field", async () => {
      const owned = await givenOwned();

      await expect(owned.findMany({ metadata: null })).resolves.toEqual([
        expect.objectContaining({ id: "o_2" }),
      ]);
    });
  });

  describe("writes", () => {
    it("patches one row and leaves the others alone", async () => {
      const notes = await givenNotes();

      await expect(notes.patch("n_1", { title: "renamed" })).resolves.toMatchObject({
        id: "n_1",
        title: "renamed",
      });
      await expect(notes.findById("n_2")).resolves.toEqual({
        id: "n_2",
        title: "second",
        pinned: false,
      });
    });

    it("patches every matching row", async () => {
      const notes = await givenNotes();

      await expect(notes.patchWhere({ pinned: true }, { pinned: false })).resolves.toHaveLength(1);
      await expect(notes.findMany({ pinned: true })).resolves.toEqual([]);
    });

    it("returns the rows it deletes and keeps the rest", async () => {
      const notes = await givenNotes();

      await expect(notes.delete(["n_1"])).resolves.toEqual([
        { id: "n_1", title: "first", pinned: true },
      ]);
      await expect(notes.findById("n_1")).resolves.toBeNull();
      await expect(notes.findMany({})).resolves.toHaveLength(1);
    });

    it("deletes every row matching a filter", async () => {
      const notes = await givenNotes();

      await expect(notes.deleteWhere({ pinned: false })).resolves.toEqual([
        { id: "n_2", title: "second", pinned: false },
      ]);
      await expect(notes.findMany({})).resolves.toHaveLength(1);
    });
  });

  describe("transactions", () => {
    it("commits the rows written inside", async () => {
      const { notes } = createNotes();

      await notes.transaction(async (context) => {
        await notes.withContext(context).insert({ id: "n_1", title: "first", pinned: false });
      });

      expect(notes.getContext().isInTransaction).toBe(false);
      await expect(notes.findMany({})).resolves.toHaveLength(1);
    });

    it("rolls the rows back when the callback throws", async () => {
      const { notes } = createNotes();

      const run = notes.transaction(async (context) => {
        await notes.withContext(context).insert({ id: "n_1", title: "first", pinned: false });
        throw new Error("boom");
      });

      await expect(run).rejects.toThrow("boom");
      await expect(notes.findMany({})).resolves.toEqual([]);
    });

    it("rolls back only the nested scope that failed", async () => {
      const { notes } = createNotes();
      const outer = { id: "n_1", title: "first", pinned: false } as const;

      await notes.transaction(async (context) => {
        await notes.withContext(context).insert(outer);

        await expect(
          notes.withContext(context).transaction(async (nested) => {
            await notes.withContext(nested).insert({ id: "n_2", title: "inner", pinned: false });
            throw new Error("boom");
          }),
        ).rejects.toThrow("boom");
      });

      await expect(notes.findMany({})).resolves.toEqual([outer]);
    });

    it("discards the inner commits when the outer scope fails", async () => {
      const { notes } = createNotes();

      await expect(
        notes.transaction(async (context) => {
          await notes.withContext(context).transaction(async (nested) => {
            await notes.withContext(nested).insert({ id: "n_1", title: "inner", pinned: false });
          });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      await expect(notes.findMany({})).resolves.toEqual([]);
    });
  });
});

describe("createMemoryRepositories", () => {
  it("shares one store between the repositories", async () => {
    const { assets, resources, reset } = createMemoryRepositories();

    const asset = await assets.insert({
      bucket: "assets",
      key: "assets/cat.png",
      hashAlgorithm: "sha256",
      hashHex: "a".repeat(64),
      size: 3,
      mimeType: "image/png",
    });
    await resources.insert({
      assetId: asset.id,
      owner: { userId: "u_1" },
      kind: "userAvatar",
      label: null,
      fileName: "cat.png",
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    });

    await expect(assets.findMany({})).resolves.toHaveLength(1);
    await expect(resources.findMany({ assetId: asset.id })).resolves.toHaveLength(1);

    reset();

    await expect(assets.findMany({})).resolves.toEqual([]);
    await expect(resources.findMany({})).resolves.toEqual([]);
  });

  it("rolls every repository back to the start of the transaction", async () => {
    const { assets, resources, transaction } = createMemoryRepositories();

    const run = transaction({ isInTransaction: false }, async () => {
      const asset = await assets.insert({
        bucket: "assets",
        key: "assets/cat.png",
        hashAlgorithm: "sha256",
        hashHex: "a".repeat(64),
        size: 3,
        mimeType: "image/png",
      });
      await resources.insert({
        assetId: asset.id,
        owner: { userId: "u_1" },
        kind: "userAvatar",
        label: null,
        fileName: "cat.png",
        metadata: null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      });

      throw new Error("boom");
    });

    await expect(run).rejects.toThrow("boom");
    await expect(assets.findMany({})).resolves.toEqual([]);
    await expect(resources.findMany({})).resolves.toEqual([]);
  });

  it("hands the transaction callback a transactional context", async () => {
    const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();

    const context = await transaction(
      {
        isInTransaction: false,
        assetRepo: assets,
        resourceRepo: resources,
        uploadSessionRepo: uploadSessions,
      },
      (context) => Promise.resolve(context),
    );

    // Everything the callback reaches through its context is bound to the
    // transaction, without the caller rebinding anything.
    expect(context.isInTransaction).toBe(true);
    expect(context.assetRepo).not.toBe(assets);
    expect(context.assetRepo.getContext().isInTransaction).toBe(true);
    expect(context.resourceRepo.getContext().isInTransaction).toBe(true);
    expect(context.uploadSessionRepo.getContext().isInTransaction).toBe(true);
  });
});
