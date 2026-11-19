import { expect, expectTypeOf, test } from "vitest";
import type { ClientDefinition, ClientResourceDefinition } from "../../src/contracts/index.js";
import {
  type ClientOperations,
  type ClientResolveClaims,
  type ClientResourceKind,
  type ClientUploadInitialize,
  createSuitcaseOperations,
  type Operation,
} from "../../src/contracts/operations.js";
import { createRecordingTransport, resourceId } from "../support/recording-transport.js";

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

/** A definition whose only kind asks for nothing: no read claim and no upload intent. */
type PlainDefinition = ClientDefinition<{
  plain: ClientResourceDefinition<{
    owner: { userId: string };
    read: never;
    uploadIntent: never;
  }>;
}>;

/** The methods one namespace of the nested client surface declares. */
type Members<T extends keyof ClientOperations> = keyof ClientOperations[T] & string;

/** The nested surface as flat operation names: `resources.resolve`, `uploads.finalize`, … */
type OperationNames = {
  [TNamespace in keyof ClientOperations]: `${TNamespace & string}.${Members<TNamespace>}`;
}[keyof ClientOperations];

test("gives every operation the contract declares a method, and no others", () => {
  expectTypeOf<OperationNames>().toEqualTypeOf<Operation>();
});

test("names the kinds a definition declares", () => {
  expectTypeOf<ClientResourceKind<TestDefinition>>().toEqualTypeOf<"avatar" | "invoice">();
});

test("keys the resolve claims by kind, each typed by that kind's read", () => {
  expectTypeOf<ClientResolveClaims<TestDefinition>>().toEqualTypeOf<{
    avatar?: { userId: string };
    invoice?: { teamId: string };
  }>();
});

test("asks for no claim when a kind's read takes none", () => {
  expectTypeOf<ClientResolveClaims<PlainDefinition>>().toEqualTypeOf<{ plain?: never }>();
});

test("binds the initialize input to one kind without dropping the contract's fields", () => {
  type Input = ClientUploadInitialize<TestDefinition, "avatar">;

  expectTypeOf<Input["kind"]>().toEqualTypeOf<"avatar">();
  expectTypeOf<Input["claims"]["intent"]>().toEqualTypeOf<{ folderId: string } | undefined>();
  expectTypeOf<Input["claims"]["fileName"]>().toEqualTypeOf<string>();
  expectTypeOf<Input["claims"]["metadata"]>().toEqualTypeOf<
    Record<string, unknown> | null | undefined
  >();
});

test("narrows the callable surface to the definition", () => {
  const { transport } = createRecordingTransport();
  const operations = createSuitcaseOperations<TestDefinition>({ transport });

  type ResolveInput = Parameters<typeof operations.resources.resolve>[0];
  type ConstraintsInput = Parameters<typeof operations.uploads.constraints>[0];

  expectTypeOf<ResolveInput["requestedIds"]>().toEqualTypeOf<string[]>();
  expectTypeOf<ResolveInput["claims"]>().toEqualTypeOf<ClientResolveClaims<TestDefinition>>();
  expectTypeOf<ConstraintsInput["kind"]>().toEqualTypeOf<ClientResourceKind<TestDefinition>>();
  expectTypeOf(operations.uploads.initialize).toBeCallableWith({
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
});

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
