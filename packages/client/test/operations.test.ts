import type {
  ClientDefinition,
  ClientResourceDefinition,
} from "@softzweig/suitcase-core/contracts";
import { expect, test } from "vitest";
import { createSuitcaseOperations } from "../src/operations.js";
import { createRecordingTransport, resourceId } from "./support/recording-transport.js";

type TestDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: { folderId: string };
  }>;
  invoice: ClientResourceDefinition<{
    owner: { userId: string };
    read: { teamId: string };
    uploadIntent: { retentionDays: number };
  }>;
}>;

test("forwards every call under its contract name", async () => {
  const { calls, transport } = createRecordingTransport();
  const operations = createSuitcaseOperations({ transport });

  await operations.resources.resolve({ claims: {}, requestedIds: [resourceId] });
  await operations.resources.update({ id: resourceId, label: "renamed" });
  await operations.resources.delete({ resourceId });
  await operations.uploads.constraints({ kind: "avatar" });
  await operations.uploads.initialize({
    claims: {
      fileName: "avatar.png",
      hashAlgorithm: "sha256",
      hashHex: "0f",
      mimeType: "image/png",
      size: 12,
    },
    kind: "avatar",
  });
  await operations.uploads.finalize({ uploadId: resourceId });

  expect(calls.map(({ operation }) => operation)).toEqual([
    "resources.resolve",
    "resources.update",
    "resources.delete",
    "uploads.constraints",
    "uploads.initialize",
    "uploads.finalize",
  ]);
});

test("resolves with whatever the transport answered", async () => {
  const result = { hasIntent: true, maxSize: null, mimeTypes: null };
  const { transport } = createRecordingTransport({ "uploads.constraints": result });

  await expect(
    createSuitcaseOperations({ transport }).uploads.constraints({ kind: "avatar" }),
  ).resolves.toBe(result);
});

test("never lets a caller choose the reuse policy", () => {
  const { transport } = createRecordingTransport();
  const operations = createSuitcaseOperations({ transport });

  void operations.uploads.finalize({
    uploadId: resourceId,
    // @ts-expect-error - reuse is the backend's policy, and it is not part of the contract.
    reusePolicy: { type: "none" },
  });
});

test("never lets a caller choose the session lifetime", () => {
  const { transport } = createRecordingTransport();
  const operations = createSuitcaseOperations({ transport });

  void operations.uploads.initialize({
    claims: {
      fileName: "avatar.png",
      hashAlgorithm: "sha256",
      hashHex: "0f",
      mimeType: "image/png",
      size: 12,
    },
    // @ts-expect-error - session lifetime is the backend's policy, and it is not in the contract.
    expiresInSeconds: 60,
    kind: "avatar",
  });
});

test("sends the definition's claims and intent as the contract's input", async () => {
  const { calls, transport } = createRecordingTransport();
  const operations = createSuitcaseOperations<TestDefinition>({ transport });

  await operations.resources.resolve({
    claims: { avatar: { userId: "u1" }, invoice: { teamId: "t1" } },
    requestedIds: [resourceId],
  });
  await operations.uploads.initialize({
    claims: {
      fileName: "avatar.png",
      hashAlgorithm: "sha256",
      hashHex: "0f",
      intent: { folderId: "f1" },
      mimeType: "image/png",
      size: 12,
    },
    kind: "avatar",
  });

  expect(calls).toEqual([
    {
      input: {
        claims: { avatar: { userId: "u1" }, invoice: { teamId: "t1" } },
        requestedIds: [resourceId],
      },
      operation: "resources.resolve",
    },
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
  ]);
});

test("restricts the kind to the ones the definition declares", () => {
  const { transport } = createRecordingTransport();
  const operations = createSuitcaseOperations<TestDefinition>({ transport });

  // @ts-expect-error - `document` is not a kind this definition declares.
  void operations.uploads.constraints({ kind: "document" });
});

test("keeps an intent tied to its own kind", () => {
  const { transport } = createRecordingTransport();
  const operations = createSuitcaseOperations<TestDefinition>({ transport });

  void operations.uploads.initialize({
    claims: {
      fileName: "invoice.png",
      hashAlgorithm: "sha256",
      hashHex: "0f",
      // @ts-expect-error - `retentionDays` belongs to the invoice kind, not the avatar one.
      intent: { retentionDays: 30 },
      mimeType: "image/png",
      size: 12,
    },
    kind: "avatar",
  });
});
