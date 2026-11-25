import type { Asset } from "@softzweig/suitcase-core";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import type { ServiceOperations } from "@softzweig/suitcase-core/contracts";
import {
  createSuitcaseServer,
  Suitcase,
  type SuitcaseTransactionRunner,
} from "@softzweig/suitcase-server";
import {
  createMemoryBucketConfig,
  MemoryRepository,
  MemoryResourceRepository,
  type MemoryStore,
  MemoryUploadSessionRepository,
} from "@softzweig/suitcase-server/memory";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createHttpHandler } from "../src/handler.js";

const constraints = { hasIntent: true, maxSize: null, mimeTypes: null };

/** A well-formed id no row carries. */
const MISSING_ID = "3f1c9a7e-5f4b-4c2a-9d1e-8b6f0a2c4d5e";

/** Reaching any operation but the one under test is a failure of the test itself. */
const notCalled = () => Promise.reject(new Error("not part of this test"));

/** A handler whose only real operation is `uploads.constraints`. */
const handlerWith = (constraints: ServiceOperations["uploads.constraints"]) =>
  createHttpHandler(() => ({
    "resources.delete": notCalled,
    "resources.resolve": notCalled,
    "resources.update": notCalled,
    "uploads.constraints": constraints,
    "uploads.finalize": notCalled,
    "uploads.initialize": notCalled,
    "usage.total": notCalled,
  }));

const call = (operation: string, body?: unknown, method = "POST") =>
  new Request(`https://api.test/api/${operation}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    method,
  });

test("answers with what the service returned", async () => {
  const seen: unknown[] = [];
  const handler = handlerWith((kind) => {
    seen.push(kind);
    return { data: constraints, ok: true } as const;
  });

  const response = await handler(call("uploads.constraints", { kind: "avatar" }));

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json");
  await expect(response.json()).resolves.toEqual({ data: constraints, ok: true });
  // The wire's input reaches the operation as the contract defines it.
  expect(seen).toEqual([{ kind: "avatar" }]);
});

test("refuses a body the operation does not accept", async () => {
  const seen: unknown[] = [];
  const handler = handlerWith((kind) => {
    seen.push(kind);
    return { data: constraints, ok: true } as const;
  });

  const response = await handler(call("uploads.constraints", { kind: 12 }));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: "invalid_input", ok: false });
  expect(seen).toEqual([]);
});

test("refuses an operation it does not serve", async () => {
  const response = await handlerWith(notCalled)(call("uploads.nope", {}));

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({ code: "not_found", ok: false });
});

test("refuses anything but a POST", async () => {
  const response = await handlerWith(notCalled)(call("uploads.constraints", undefined, "GET"));

  expect(response.status).toBe(405);
  await expect(response.json()).resolves.toMatchObject({ ok: false });
});

test("turns a thrown service error into the matching status", async () => {
  const handler = handlerWith(() => {
    throw Object.assign(new Error("The file is too large."), {
      code: ServiceErrorCode.PRECONDITION_FAILED,
      details: { maxSize: 1_000 },
    });
  });

  const response = await handler(call("uploads.constraints", { kind: "avatar" }));

  expect(response.status).toBe(412);
  await expect(response.json()).resolves.toEqual({
    code: "precondition_failed",
    details: { maxSize: 1_000 },
    message: "The file is too large.",
    ok: false,
  });
});

test("keeps an unexpected failure opaque", async () => {
  const handler = handlerWith(() => {
    throw new Error('relation "assets" does not exist');
  });

  const response = await handler(call("uploads.constraints", { kind: "avatar" }));

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({
    code: "unknown",
    message: "The operation failed.",
    ok: false,
  });
});

test("blames itself, not the caller, for a payload that does not fit", async () => {
  const handler = handlerWith(() => ({ data: { hasIntent: "yes" }, ok: true }) as never);

  const response = await handler(call("uploads.constraints", { kind: "avatar" }));

  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toMatchObject({ code: "unknown", ok: false });
});

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";

/** What the client claims about the file; every upload here sends the same one. */
const claims = {
  fileName: "cat.png",
  hashAlgorithm: "sha256",
  hashHex: "a".repeat(64),
  mimeType: "image/png",
  size: 3,
} as const;

/**
 * A real server — definition, services, api — on in-memory adapters, wired the way a deployment
 * wires it. Only the adapters are stand-ins; everything the handler talks to is production code.
 */
const givenEndpoints = (): ServiceOperations => {
  const buckets = {
    [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
    [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
  };

  const definition = Suitcase.withBuckets(buckets).withResources(({ owner, read, resource }) => {
    const user = owner({ authorize: () => true, schema: z.object({ userId: z.string() }) });

    return {
      userAvatar: resource("userAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          maxSize: "2 MB",
          mimeTypes: ["image/png"],
          ownedBy: () => ({ userId: "u_1" }),
        }),
      }),
    };
  });

  const store: MemoryStore = new Map();
  const repositories = {
    assets: new MemoryRepository<Asset>(store, "assets"),
    resources: new MemoryResourceRepository(store),
    uploadSessions: new MemoryUploadSessionRepository(store),
  };

  // The same scope the server package's own tests use: one rollback over the shared store, with
  // the handles rebound to the transaction the way a database adapter rebinds them.
  const transaction: SuitcaseTransactionRunner = (context, work) =>
    repositories.assets.transaction(() =>
      work({
        ...context,
        assetRepo: repositories.assets.withContext({ isInTransaction: true, store }),
        isInTransaction: true,
        resourceRepo: repositories.resources.withContext({ isInTransaction: true, store }),
        uploadSessionRepo: repositories.uploadSessions.withContext({
          isInTransaction: true,
          store,
        }),
      } as typeof context),
    );

  return createSuitcaseServer(definition, { repositories, transaction }).forExecution({})
    .operations;
};

describe("against a real server", () => {
  const handler = () => createHttpHandler(givenEndpoints);

  test("advertises what the definition declares", async () => {
    const response = await handler()(call("uploads.constraints", { kind: "userAvatar" }));

    expect(response.status).toBe(200);
    // `maxSize` was written as an operand and reaches the client in bytes.
    await expect(response.json()).resolves.toEqual({
      data: { hasIntent: false, maxSize: 2_000_000, mimeTypes: ["image/png"] },
      ok: true,
    });
  });

  test("opens a session for the kind it was asked about", async () => {
    const response = await handler()(call("uploads.initialize", { claims, kind: "userAvatar" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        reused: false,
        upload: { kind: "userAvatar", owner: { userId: "u_1" }, status: "pending" },
      },
      ok: true,
    });
  });

  test("answers a refusal with the code the service chose", async () => {
    const response = await handler()(
      call("uploads.initialize", {
        claims: { ...claims, mimeType: "image/gif" },
        kind: "userAvatar",
      }),
    );

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({
      code: ServiceErrorCode.PRECONDITION_FAILED,
      ok: false,
    });
  });

  test("answers an unknown kind as not found", async () => {
    const response = await handler()(call("uploads.constraints", { kind: "nope" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: ServiceErrorCode.NOT_FOUND,
      ok: false,
    });
  });

  // Every remaining route, reaching its real service; a missing row is enough to prove the wiring.
  test.for([
    { operation: "resources.delete", body: { resourceId: MISSING_ID } },
    { operation: "resources.update", body: { id: MISSING_ID, label: "renamed" } },
    { operation: "uploads.finalize", body: { uploadId: MISSING_ID } },
  ])("reaches the service behind $operation", async ({ operation, body }) => {
    const response = await handler()(call(operation, body));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: ServiceErrorCode.NOT_FOUND,
      ok: false,
    });
  });

  test("resolves nothing for an empty request", async () => {
    const response = await handler()(call("resources.resolve", { claims: {}, requestedIds: [] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [], ok: true });
  });
});
