import type {
  ClientDefinition,
  ClientResourceDefinition,
  UploadConstraintsResult,
} from "@softzweig/suitcase-core/contracts";
import { describe, expect, test } from "vitest";
import { SuitcaseClientError } from "../src/error.js";
import {
  bytes,
  constraints,
  createClient,
  file,
  finalized,
  operations,
  reused,
  reusing,
  sendTo,
  sentClaims,
  session,
  upload,
} from "./support/upload-client.js";

type PlainDefinition = ClientDefinition<{
  plain: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: never;
  }>;
}>;

describe("the client", () => {
  test("exposes the calls that stand alone, and the whole wire beside them", async () => {
    const { calls, client } = createClient({
      "resources.resolve": [],
      "uploads.constraints": constraints(),
      "uploads.finalize": finalized,
    });

    await client.upload.constraints({ kind: "avatar" });
    await client.resources.resolve({ claims: {}, requestedIds: [] });
    await client.operations.uploads.finalize({ uploadId: session.id });

    expect(client.operations.resources).toBe(client.resources);
    expect(client.operations.uploads.constraints).toBe(client.upload.constraints);
    expect(operations(calls)).toEqual([
      "uploads.constraints",
      "resources.resolve",
      "uploads.finalize",
    ]);
  });

  test("requires the intent the kind declares", () => {
    const { client } = createClient({});
    const check = (input: Parameters<typeof client.upload.start>[0]) => input;

    check({ file: file(12), intent: { folderId: "f1" }, kind: "avatar" });
    // @ts-expect-error - `avatar` declares an intent, so silence is not accepted.
    check({ file: file(12), kind: "avatar" });
  });

  test("asks for no intent when the kind declares none", () => {
    const { client } = createClient<PlainDefinition>({});
    const check = (input: Parameters<typeof client.upload.start>[0]) => input;

    check({ file: file(12), kind: "plain" });
    check({
      file: file(12),
      // @ts-expect-error - `plain` declares no intent, so there is nothing to state.
      intent: { anything: true },
      kind: "plain",
    });
  });
});

describe("uploading", () => {
  test("sends the bytes and finalizes a new upload", async () => {
    const { calls, client, transferred } = createClient({
      "uploads.constraints": constraints({ maxSize: bytes("10 MB"), mimeTypes: ["image/png"] }),
      "uploads.finalize": finalized,
      "uploads.initialize": sendTo(),
    });

    const result = await upload(client);

    expect(calls).toEqual([
      { input: { kind: "avatar" }, operation: "uploads.constraints" },
      {
        input: {
          claims: {
            fileName: "avatar.png",
            hashAlgorithm: "sha256",
            hashHex: "0f",
            intent: { folderId: "f1" },
            mimeType: "image/png",
            size: 12,
          },
          kind: "avatar",
        },
        operation: "uploads.initialize",
      },
      { input: { uploadId: finalized.upload.id }, operation: "uploads.finalize" },
    ]);
    expect(transferred).toEqual([
      { bytes: expect.any(ArrayBuffer), url: "https://storage.test/avatar.png" },
    ]);
    expect(result).toEqual({
      resource: finalized.resource,
      reused: false,
      upload: finalized.upload,
    });
  });

  test("keeps the metadata it was handed on the session", async () => {
    const metadata = { caption: "holiday" };
    const { calls, client } = createClient(reusing());

    await upload(client, { metadata });

    expect(sentClaims(calls)).toMatchObject({ metadata });
  });

  test("returns the resource without sending bytes when the backend reuses one", async () => {
    const { calls, client, transferred } = createClient(reusing());

    await expect(upload(client)).resolves.toEqual(reused);

    expect(operations(calls)).toEqual(["uploads.constraints", "uploads.initialize"]);
    expect(transferred).toEqual([]);
  });
});

describe("limits", () => {
  test.for<{
    name: string;
    limits: Partial<UploadConstraintsResult>;
    picked: ReturnType<typeof file>;
  }>([
    {
      name: "a file past the maximum size",
      limits: { maxSize: bytes("1 KB") },
      picked: file(bytes("2 KiB")),
    },
    {
      name: "a file of an unsupported type",
      limits: { mimeTypes: ["image/png"] },
      picked: file(12, "text/plain"),
    },
  ])("refuses $name before initializing", async ({ limits, picked }) => {
    const { calls, client, transferred } = createClient({
      "uploads.constraints": constraints(limits),
    });

    await expect(upload(client, { file: picked })).rejects.toBeInstanceOf(SuitcaseClientError);
    expect(operations(calls)).toEqual(["uploads.constraints"]);
    expect(transferred).toEqual([]);
  });

  test("reports the limit it refused on", async () => {
    const { client } = createClient({
      "uploads.constraints": constraints({ maxSize: bytes("1 KB") }),
    });

    await expect(upload(client, { file: file(bytes("2 KiB")) })).rejects.toMatchObject({
      code: "precondition_failed",
      details: { maxSize: bytes("1 KB"), size: bytes("2 KiB") },
    });
  });

  test("accepts a file that is exactly at the limit", async () => {
    const { client } = createClient(
      reusing({ "uploads.constraints": constraints({ maxSize: bytes("1 KB") }) }),
    );

    await expect(upload(client, { file: file(bytes("1 KB")) })).resolves.toEqual(reused);
  });
});

describe("cancellation", () => {
  test("asks the backend nothing when the signal is already aborted", async () => {
    const { calls, client, transferred } = createClient({});

    await expect(upload(client, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toEqual([]);
    expect(transferred).toEqual([]);
  });

  test("does not finalize when the transfer is aborted", async () => {
    const controller = new AbortController();
    const { calls, client, transferred } = createClient(
      { "uploads.constraints": constraints(), "uploads.initialize": sendTo() },
      { transfer: async () => controller.abort() },
    );

    await expect(upload(client, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(operations(calls)).toEqual(["uploads.constraints", "uploads.initialize"]);
    expect(transferred).toEqual([]);
  });

  test("hands the caller's signal to the transfer", async () => {
    const controller = new AbortController();
    const seen: { signal?: AbortSignal; size: number }[] = [];

    const { client } = createClient(
      {
        "uploads.constraints": constraints(),
        "uploads.finalize": finalized,
        "uploads.initialize": sendTo(),
      },
      {
        transfer: async (_target, bytes, signal) => {
          seen.push({ signal, size: bytes.byteLength });
        },
      },
    );

    await upload(client, { signal: controller.signal });

    expect(seen).toEqual([{ signal: controller.signal, size: 12 }]);
  });
});

describe("failures", () => {
  test("surfaces a failed initialize without sending anything", async () => {
    const { calls, client, transferred } = createClient({
      "uploads.constraints": constraints(),
      "uploads.initialize": new Error("claims refused"),
    });

    await expect(upload(client)).rejects.toThrow("claims refused");
    expect(operations(calls)).toEqual(["uploads.constraints", "uploads.initialize"]);
    expect(transferred).toEqual([]);
  });

  test("surfaces a failed transfer without finalizing", async () => {
    const { calls, client } = createClient(
      { "uploads.constraints": constraints(), "uploads.initialize": sendTo() },
      {
        transfer: async () => {
          throw new Error("connection reset");
        },
      },
    );

    await expect(upload(client)).rejects.toThrow("connection reset");
    expect(operations(calls)).toEqual(["uploads.constraints", "uploads.initialize"]);
  });

  test("surfaces a failed finalize", async () => {
    const { calls, client } = createClient({
      "uploads.constraints": constraints(),
      "uploads.finalize": new Error("session expired"),
      "uploads.initialize": sendTo(),
    });

    await expect(upload(client)).rejects.toThrow("session expired");
    expect(operations(calls)).toEqual([
      "uploads.constraints",
      "uploads.initialize",
      "uploads.finalize",
    ]);
  });
});
