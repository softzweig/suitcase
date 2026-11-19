import type { AssetHash } from "@softzweig/suitcase-core";
import type {
  ClientDefinition,
  ClientResourceDefinition,
} from "@softzweig/suitcase-core/contracts";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { expect, test } from "vitest";
import { createSuitcaseClient } from "../src/client.js";
import { SuitcaseClientError } from "../src/error.js";
import type { UploadFile } from "../src/upload.js";
import { createRecordingTransport, resourceId } from "./support/recording-transport.js";

type TestDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: { folderId: string };
  }>;
}>;

type PlainDefinition = ClientDefinition<{
  plain: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: never;
  }>;
}>;

const session = { id: "6d0f3f52-1b6a-4a5e-9d8b-2f9d1a0c7e31", kind: "avatar" };
const resource = { id: resourceId, kind: "avatar", label: null };
const hash: AssetHash = { hashAlgorithm: "sha256", hashHex: "0f" };

const file = (size: number, type = "image/png"): UploadFile => ({
  arrayBuffer: async () => new ArrayBuffer(size),
  name: "avatar.png",
  size,
  type,
});

const createClient = (answers: Parameters<typeof createRecordingTransport>[0]) => {
  const { calls, transport } = createRecordingTransport(answers);
  const transferred: { bytes: ArrayBuffer; url: string }[] = [];

  const client = createSuitcaseClient<TestDefinition>({
    digest: async () => hash,
    operations: createSuitcaseOperations<TestDefinition>({ transport }),
    transfer: async (target, bytes) => {
      transferred.push({ bytes, url: target.url });
    },
  });

  return { calls, client, transferred };
};

test("exposes the calls that stand alone without the session internals", async () => {
  const { calls, client } = createClient({
    "resources.resolve": [],
    "uploads.constraints": { hasIntent: true, maxSize: null, mimeTypes: null },
  });

  await client.upload.constraints({ kind: "avatar" });
  await client.resources.resolve({ claims: {}, requestedIds: [resourceId] });

  expect(calls.map(({ operation }) => operation)).toEqual([
    "uploads.constraints",
    "resources.resolve",
  ]);
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
  const { transport } = createRecordingTransport();
  const client = createSuitcaseClient<PlainDefinition>({
    digest: async () => hash,
    operations: createSuitcaseOperations<PlainDefinition>({ transport }),
    transfer: async () => undefined,
  });
  const check = (input: Parameters<typeof client.upload.start>[0]) => input;

  check({ file: file(12), kind: "plain" });
  check({
    file: file(12),
    // @ts-expect-error - `plain` declares no intent, so there is nothing to state.
    intent: { anything: true },
    kind: "plain",
  });
});

test("uploads the bytes when the backend has nothing to reuse", async () => {
  const { calls, client, transferred } = createClient({
    "uploads.constraints": { hasIntent: true, maxSize: "10 MB", mimeTypes: ["image/png"] },
    "uploads.finalize": { resource, upload: session },
    "uploads.initialize": {
      reused: false,
      target: { method: "PUT", url: "https://storage.test/avatar.png" },
      upload: session,
    },
  });

  const result = await client.upload.start({
    file: file(12),
    intent: { folderId: "f1" },
    kind: "avatar",
  });

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
    {
      input: { uploadId: session.id },
      operation: "uploads.finalize",
    },
  ]);
  expect(transferred).toEqual([
    { bytes: expect.any(ArrayBuffer), url: "https://storage.test/avatar.png" },
  ]);
  expect(result).toEqual({ resource, reused: false, upload: session });
});

test("returns the resource without sending bytes when the backend reuses one", async () => {
  const { calls, client, transferred } = createClient({
    "uploads.constraints": { hasIntent: true, maxSize: null, mimeTypes: null },
    "uploads.initialize": { resource, reused: true, upload: session },
  });

  const result = await client.upload.start({
    file: file(12),
    intent: { folderId: "f1" },
    kind: "avatar",
  });

  expect(calls.map(({ operation }) => operation)).toEqual([
    "uploads.constraints",
    "uploads.initialize",
  ]);
  expect(transferred).toEqual([]);
  expect(result).toEqual({ resource, reused: true, upload: session });
});

test.for([
  {
    limits: { hasIntent: false, maxSize: "1 KB", mimeTypes: null },
    name: "a file past the maximum size",
    size: 2_048,
    type: "image/png",
  },
  {
    limits: { hasIntent: false, maxSize: null, mimeTypes: ["image/png"] },
    name: "a file of an unsupported type",
    size: 12,
    type: "text/plain",
  },
])("refuses $name before initializing", async ({ limits, size, type }) => {
  const { calls, client, transferred } = createClient({ "uploads.constraints": limits });

  await expect(
    client.upload.start({ file: file(size, type), intent: { folderId: "f1" }, kind: "avatar" }),
  ).rejects.toBeInstanceOf(SuitcaseClientError);
  expect(calls.map(({ operation }) => operation)).toEqual(["uploads.constraints"]);
  expect(transferred).toEqual([]);
});

test("reports the limit it refused on", async () => {
  const { client } = createClient({
    "uploads.constraints": { hasIntent: false, maxSize: "1 KB", mimeTypes: null },
  });

  await expect(
    client.upload.start({
      file: file(2_048),
      intent: { folderId: "f1" },
      kind: "avatar",
    }),
  ).rejects.toMatchObject({
    code: "precondition_failed",
    details: { maxSize: 1_000, size: 2_048 },
  });
});

test("asks the backend nothing when the signal is already aborted", async () => {
  const { calls, client, transferred } = createClient({});

  await expect(
    client.upload.start({
      file: file(12),
      intent: { folderId: "f1" },
      kind: "avatar",
      signal: AbortSignal.abort(),
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toEqual([]);
  expect(transferred).toEqual([]);
});

test("stops before finalizing when the transfer is aborted", async () => {
  const { calls, transport } = createRecordingTransport({
    "uploads.constraints": { hasIntent: false, maxSize: null, mimeTypes: null },
    "uploads.initialize": {
      reused: false,
      target: { method: "PUT", url: "https://storage.test/avatar.png" },
      upload: session,
    },
  });
  const controller = new AbortController();

  const client = createSuitcaseClient<TestDefinition>({
    digest: async () => hash,
    operations: createSuitcaseOperations<TestDefinition>({ transport }),
    transfer: async () => controller.abort(),
  });

  await expect(
    client.upload.start({
      file: file(12),
      intent: { folderId: "f1" },
      kind: "avatar",
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls.map(({ operation }) => operation)).toEqual([
    "uploads.constraints",
    "uploads.initialize",
  ]);
});
