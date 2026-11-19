import type {
  ClientDefinition,
  ClientResourceDefinition,
  UploadConstraintsResult,
} from "@softzweig/suitcase-core/contracts";
import { expect, test } from "vitest";
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
  upload,
} from "./support/upload-client.js";

type PlainDefinition = ClientDefinition<{
  plain: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: never;
  }>;
}>;

test("exposes the calls that stand alone, without the session internals", async () => {
  const { calls, client } = createClient({
    "resources.resolve": [],
    "uploads.constraints": constraints(),
  });

  await client.upload.constraints({ kind: "avatar" });
  await client.resources.resolve({ claims: {}, requestedIds: [] });

  expect(operations(calls)).toEqual(["uploads.constraints", "resources.resolve"]);
  // A session is started and finished only inside `upload.start`, so neither is on the client.
  expect(client).not.toHaveProperty("operations");
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
  expect(result).toEqual({ resource: finalized.resource, reused: false, upload: finalized.upload });
});

test("returns the resource without sending bytes when the backend reuses one", async () => {
  const { calls, client, transferred } = createClient(reusing());

  await expect(upload(client)).resolves.toEqual(reused);

  expect(operations(calls)).toEqual(["uploads.constraints", "uploads.initialize"]);
  expect(transferred).toEqual([]);
});

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
