import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { createUploadQueue } from "@softzweig/suitcase-upload-queue";
import { describe, expect, test } from "vitest";
import {
  createExampleApp,
  type ExampleClient,
  pdfFile,
  pngFile,
  type Stack,
} from "./support/app.js";
import { createPgExampleApp } from "./support/pg.js";

/** The claims a resolve may carry, as the app's own definition types them. */
type ResolveClaims = Parameters<Stack["client"]["resources"]["resolve"]>[0]["claims"];

/** The same spec, on every adapter a deployment may choose. */
const stacks = [
  { create: createExampleApp, name: "memory" },
  { create: createPgExampleApp, name: "postgres" },
];

/** Resolves the one id a test uploaded and insists it came back readable. */
const resolved = async (app: Stack, claims: ResolveClaims, resourceId: string) => {
  const [entry] = await app.client.resources.resolve({ claims, requestedIds: [resourceId] });

  if (!entry?.ok) throw new Error(`Expected ${resourceId} to resolve.`);

  return entry;
};

describe("the upload flow", () => {
  test.for(stacks)("$name: uploads a file, and resolves it back by id", async ({ create }) => {
    const app = await create();

    const { resource, reused } = await app.client.upload.start({
      file: pngFile(1_024),
      kind: "userAvatar",
    });

    expect(reused).toBe(false);
    expect(resource).toMatchObject({
      fileName: "cat.png",
      kind: "userAvatar",
      label: null,
      owner: app.user,
    });
    // The client put the bytes where the target pointed: the upload bucket, once.
    expect(app.transfers).toHaveLength(1);

    const entry = await resolved(app, {}, resource.id);

    expect(entry).toMatchObject({ fileName: "cat.png", id: resource.id, label: null });
    expect(entry.url.type).toBe("signed");

    if (entry.url.type !== "signed") throw new Error("Expected a signed url.");

    // The link points at the asset the upload was promoted to, and the object is there.
    expect(entry.url.url).toMatch(/^memory:\/\/assets\//);

    const key = entry.url.url.replace("memory://assets/", "");
    await expect(app.assets.get(key)).resolves.toMatchObject({ key, size: 1_024 });
  });

  test.for(stacks)("$name: reuses the bytes it already stores", async ({ create }) => {
    const app = await create();

    const first = await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });
    const second = await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.resource.id).toBe(first.resource.id);
    // Nothing was transferred the second time.
    expect(app.transfers).toHaveLength(1);
  });

  test.for(stacks)(
    "$name: owns the resource as the user the request ran as",
    async ({ create }) => {
      const app = await create({ userId: "u_2" });

      const { resource } = await app.client.upload.start({
        file: pngFile(128, 3),
        kind: "userAvatar",
      });

      // `ownedBy` read the execution context, so the owner is not a constant.
      expect(resource.owner).toEqual({ userId: "u_2" });
    },
  );

  test.for(stacks)("$name: hands out only what the claim may read", async ({ create }) => {
    const app = await create();

    const mine = await app.client.upload.start({
      file: pdfFile(2_048),
      intent: { folderId: "f_1" },
      kind: "invoice",
      metadata: { tenantId: "t_1" },
    });
    const theirs = await app.client.upload.start({
      file: pdfFile(2_048, 12),
      intent: { folderId: "f_2" },
      kind: "invoice",
      metadata: { tenantId: "t_2" },
    });

    const entries = await app.client.resources.resolve({
      claims: { invoice: { tenantId: "t_1" } },
      requestedIds: [mine.resource.id, theirs.resource.id, crypto.randomUUID()],
    });

    expect(entries.map((entry) => entry.ok)).toEqual([true, false, false]);
    // A resource another tenant holds and one that does not exist answer the same way, so the
    // list cannot be used to discover what else is stored.
    expect(entries.slice(1)).toEqual([
      { code: ServiceErrorCode.NOT_FOUND, id: theirs.resource.id, ok: false },
      { code: ServiceErrorCode.NOT_FOUND, id: entries[2]?.id, ok: false },
    ]);
  });

  test.for(stacks)(
    "$name: renames a resource, deletes it, then no longer resolves it",
    async ({ create }) => {
      const app = await create();

      const { resource } = await app.client.upload.start({
        file: pngFile(512),
        kind: "userAvatar",
      });

      const renamed = await app.client.resources.update({ id: resource.id, label: "Renamed" });
      expect(renamed).toMatchObject({ id: resource.id, label: "Renamed" });

      await app.client.resources.delete({ resourceId: resource.id });

      const [entry] = await app.client.resources.resolve({
        claims: {},
        requestedIds: [resource.id],
      });
      expect(entry).toEqual({ code: ServiceErrorCode.NOT_FOUND, id: resource.id, ok: false });
    },
  );

  test.for(stacks)("$name: surfaces a refusal as the client's own error", async ({ create }) => {
    const app = await create();

    // The handler answered 404 and the transport translated it, code and message included.
    await expect(
      app.client.resources.update({ id: crypto.randomUUID(), label: "Renamed" }),
    ).rejects.toMatchObject({ code: ServiceErrorCode.NOT_FOUND });
  });
});

describe("a batch of uploads", () => {
  test.for(stacks)("$name: goes out one at a time when the queue says so", async ({ create }) => {
    const app = await create();
    const queue = createUploadQueue<ExampleClient>(app.client.upload.start, { concurrency: 1 });

    const settled = await Promise.all(
      [1, 2, 3].map((seed) => queue.enqueue({ file: pngFile(256, seed), kind: "userAvatar" })),
    );

    expect(settled.every(({ reused }) => reused === false)).toBe(true);
    expect(app.transfers).toHaveLength(3);
    expect(app.peakTransfers()).toBe(1);
  });
});

describe("storage usage", () => {
  test.for(stacks)("$name: reports what the caller holds for a kind", async ({ create }) => {
    const app = await create();

    await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });

    const usage = await app.client.usage.total({ kinds: ["userAvatar"], owner: app.user });

    // The session resolved into the resource, so its bytes are counted once.
    expect(usage).toEqual({ resourceCount: 1, scope: "total", size: 1_024, uploadCount: 0 });
  });

  test.for(stacks)("$name: adds up the kinds it is given", async ({ create }) => {
    const app = await create();

    await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });
    await app.client.upload.start({
      file: pdfFile(2_048, 12),
      intent: { folderId: "f_1" },
      kind: "invoice",
      metadata: { tenantId: "t_1" },
    });

    const one = await app.client.usage.total({ kinds: ["userAvatar"], owner: app.user });
    const both = await app.client.usage.total({
      kinds: ["userAvatar", "invoice"],
      owner: app.user,
    });

    expect(one.size).toBe(1_024);
    expect(both).toEqual({ resourceCount: 2, scope: "total", size: 3_072, uploadCount: 0 });
  });

  test.for(stacks)(
    "$name: reserves the bytes of an upload that has not finished",
    async ({ create }) => {
      const app = await create();

      await app.client.operations.uploads.initialize({
        claims: {
          fileName: "cat.png",
          hashAlgorithm: "sha256",
          hashHex: "a".repeat(64),
          mimeType: "image/png",
          size: 2_048,
        },
        kind: "userAvatar",
      });

      const usage = await app.client.usage.total({ kinds: ["userAvatar"], owner: app.user });

      expect(usage).toEqual({ resourceCount: 0, scope: "total", size: 2_048, uploadCount: 1 });
    },
  );

  test.for(stacks)("$name: keeps another kind out of the answer", async ({ create }) => {
    const app = await create();

    await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });

    const usage = await app.client.usage.total({ kinds: ["invoice"], owner: app.user });

    expect(usage).toEqual({ resourceCount: 0, scope: "total", size: 0, uploadCount: 0 });
  });

  test.for(stacks)("$name: refuses an owner the caller may not look at", async ({ create }) => {
    const app = await create();

    // Naming an owner is a request; the owner's `authorize` is what turns it into an answer.
    await expect(
      app.client.usage.total({ kinds: ["userAvatar"], owner: { userId: "u_2" } }),
    ).rejects.toMatchObject({ code: ServiceErrorCode.FORBIDDEN });
  });
});
