import type { AssetHash } from "@softzweig/suitcase-core";
import type {
  ClientDefinition,
  ClientResourceDefinition,
  UploadConstraintsResult,
} from "@softzweig/suitcase-core/contracts";
import {
  createSuitcaseOperations,
  type OperationRequest,
} from "@softzweig/suitcase-core/contracts";
import { ByteSize, type ByteSizeOperand } from "@softzweig/suitcase-core/utils";
import { createSuitcaseClient, type SuitcaseClient } from "../../src/client.js";
import type { ProcessorRule } from "../../src/processor.js";
import type { TransferFile, UploadFile } from "../../src/upload.js";
import { createRecordingTransport, resourceId } from "./recording-transport.js";

export type TestDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: { folderId: string };
    uploadMetadata: { caption: string } | undefined;
  }>;
}>;

export type Answers = Parameters<typeof createRecordingTransport>[0];

/** Loose on purpose: the recording transport hands answers back exactly as registered. */
export const session = { id: "6d0f3f52-1b6a-4a5e-9d8b-2f9d1a0c7e31", kind: "avatar" };
export const resource = { id: resourceId, kind: "avatar", label: null };
export const hash: AssetHash = { hashAlgorithm: "sha256", hashHex: "0f" };

export const file = (size: number, type = "image/png"): UploadFile => ({
  arrayBuffer: async () => new ArrayBuffer(size),
  name: "avatar.png",
  size,
  type,
});

/** A byte count, spelled the way a definition would spell it: `bytes("5 MB")`. */
export const bytes = (operand: ByteSizeOperand) => ByteSize.parse(operand).toBytes();

/** What a kind advertises, open unless the test narrows it. */
export const constraints = (
  overrides: Partial<UploadConstraintsResult> = {},
): UploadConstraintsResult => ({
  hasIntent: true,
  maxSize: null,
  mimeTypes: null,
  ...overrides,
});

/** The backend reusing bytes it already has: nothing is transferred. */
export const reused = { resource, reused: true, upload: session } as const;

/** The backend asking for the bytes, at a target of the test's choosing. */
export const sendTo = (url = "https://storage.test/avatar.png") =>
  ({ reused: false, target: { method: "PUT", url }, upload: session }) as const;

/** The resource an upload settled on. */
export const finalized = { resource, upload: session } as const;

/** The operation each recorded call named, in order. */
export const operations = (calls: readonly OperationRequest[]) =>
  calls.map(({ operation }) => operation);

/** What the client claimed when it opened the session, or `undefined` if it never did. */
export const sentClaims = (calls: readonly OperationRequest[]) => {
  const initialize = calls.find(({ operation }) => operation === "uploads.initialize");
  return initialize?.operation === "uploads.initialize" ? initialize.input.claims : undefined;
};

/** Ready-made answers for an upload the backend settles by reusing what it stores. */
export const reusing = (overrides: Answers = {}): Answers => ({
  "uploads.constraints": constraints(),
  "uploads.initialize": reused,
  ...overrides,
});

export const createClient = <TDefinition extends ClientDefinition = TestDefinition>(
  answers: Answers,
  { processors, transfer }: { processors?: readonly ProcessorRule[]; transfer?: TransferFile } = {},
) => {
  const { calls, transport } = createRecordingTransport(answers);
  const transferred: { bytes: ArrayBuffer; url: string }[] = [];

  const client = createSuitcaseClient<TDefinition>({
    digest: async () => hash,
    operations: createSuitcaseOperations<TDefinition>({ transport }),
    processors,
    transfer:
      transfer ??
      (async (target, bytes) => {
        transferred.push({ bytes, url: target.url });
      }),
  });

  return { calls, client, transferred };
};

/** Starts the one upload these tests share, with only what a test actually varies. */
export const upload = (
  client: SuitcaseClient<TestDefinition>,
  {
    file: picked = file(12),
    metadata,
    signal,
  }: { file?: UploadFile; metadata?: { caption: string }; signal?: AbortSignal } = {},
) =>
  client.upload.start({
    file: picked,
    intent: { folderId: "f1" },
    kind: "avatar",
    metadata,
    signal,
  });
