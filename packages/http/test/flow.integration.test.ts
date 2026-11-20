import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { createUploadQueue } from "@softzweig/suitcase-upload-queue";
import { describe, expect, test } from "vitest";
import { createExampleApp, type ExampleClient, pdfFile, pngFile } from "./support/app.js";

/** A whole example app: the client a consumer uses, and what the stack did behind it. */
type App = ReturnType<typeof createExampleApp>;

/** The claims a resolve may carry, as the app's own definition types them. */
type ResolveClaims = Parameters<App["client"]["resources"]["resolve"]>[0]["claims"];

/** Resolves the one id a test uploaded and insists it came back readable. */
const resolved = async (app: App, claims: ResolveClaims, resourceId: string) => {
  const [entry] = await app.client.resources.resolve({ claims, requestedIds: [resourceId] });

  if (!entry?.ok) throw new Error(`Expected ${resourceId} to resolve.`);

  return entry;
};

describe("the upload flow", () => {
  test("uploads a file, and resolves it back by id", async () => {
    const app = createExampleApp();

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

  test("reuses the bytes it already stores", async () => {
    const app = createExampleApp();

    const first = await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });
    const second = await app.client.upload.start({ file: pngFile(1_024), kind: "userAvatar" });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.resource.id).toBe(first.resource.id);
    // Nothing was transferred the second time.
    expect(app.transfers).toHaveLength(1);
  });

  test("owns the resource as the user the request ran as", async () => {
    const app = createExampleApp({ userId: "u_2" });

    const { resource } = await app.client.upload.start({
      file: pngFile(128, 3),
      kind: "userAvatar",
    });

    // `ownedBy` read the execution context, so the owner is not a constant.
    expect(resource.owner).toEqual({ userId: "u_2" });
  });

  test("hands out only what the claim may read", async () => {
    const app = createExampleApp();

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

  test("renames a resource, then deletes it, then no longer resolves it", async () => {
    const app = createExampleApp();

    const { resource } = await app.client.upload.start({
      file: pngFile(512),
      kind: "userAvatar",
    });

    const renamed = await app.client.resources.update({ id: resource.id, label: "Renamed" });
    expect(renamed).toMatchObject({ id: resource.id, label: "Renamed" });

    await app.client.resources.delete({ resourceId: resource.id });

    const [entry] = await app.client.resources.resolve({ claims: {}, requestedIds: [resource.id] });
    expect(entry).toEqual({ code: ServiceErrorCode.NOT_FOUND, id: resource.id, ok: false });
  });

  test("surfaces a refusal as the client's own error", async () => {
    const app = createExampleApp();

    // The handler answered 404 and the transport translated it, code and message included.
    await expect(
      app.client.resources.update({ id: crypto.randomUUID(), label: "Renamed" }),
    ).rejects.toMatchObject({ code: ServiceErrorCode.NOT_FOUND });
  });
});

describe("a batch of uploads", () => {
  test("goes out one at a time when the queue says so", async () => {
    const app = createExampleApp();
    const queue = createUploadQueue<ExampleClient>(app.client.upload.start, { concurrency: 1 });

    const settled = await Promise.all(
      [1, 2, 3].map((seed) => queue.enqueue({ file: pngFile(256, seed), kind: "userAvatar" })),
    );

    expect(settled.every(({ reused }) => reused === false)).toBe(true);
    expect(app.transfers).toHaveLength(3);
    expect(app.peakTransfers()).toBe(1);
  });
});
