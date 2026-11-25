import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import {
  type ClientDefinition,
  type ClientResourceDefinition,
  createSuitcaseOperations,
  type Operation,
  type OperationInput,
  type OperationOutput,
  type SuitcaseTransport,
} from "@softzweig/suitcase-core/contracts";

/** One kind, so the hooks are typed the way a consumer's would be. */
export type TestDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: { folderId: string };
    uploadMetadata: never;
  }>;
}>;

/** A definition whose kind declares no read claim, so its context can be left out. */
export type OpenDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: never;
    uploadIntent: { folderId: string };
    uploadMetadata: never;
  }>;
}>;

export type Answers = Partial<Record<Operation, unknown>>;

const owner = { userId: "u_1" };
const when = "2026-01-01T00:00:00.000Z";

/** The resource the fixtures belong to. */
export const resourceId = crypto.randomUUID();

/** What `upload.start` settles on when the backend answers by reusing bytes it already stores. */
export const reused = {
  resource: {
    assetId: crypto.randomUUID(),
    createdAt: when,
    fileName: "cat.png",
    id: resourceId,
    kind: "avatar",
    label: null,
    metadata: null,
    owner,
    updatedAt: null,
  },
  reused: true,
  upload: {
    createdAt: when,
    expiresAt: when,
    fileName: "cat.png",
    hashAlgorithm: "sha256",
    hashHex: "0f",
    id: crypto.randomUUID(),
    intent: { folderId: "f_1" },
    kind: "avatar",
    metadata: null,
    mimeType: "image/png",
    owner,
    resourceId,
    size: 12,
    status: "completed",
    updatedAt: null,
  },
} as const;

/** One entry as a resolve answers for a readable resource. */
export const download = {
  fileName: "cat.png",
  id: resourceId,
  label: null,
  ok: true,
  url: { expiresAt: when, type: "signed", url: "memory://assets/cat.png" },
} as const;

/** One entry as a resolve answers for an id the caller may not see. */
export const missing = { code: ServiceErrorCode.NOT_FOUND, id: resourceId, ok: false } as const;

/** A file a browser would hand over. */
export const file = {
  arrayBuffer: async () => new ArrayBuffer(12),
  name: "cat.png",
  size: 12,
  type: "image/png",
};

/** A client whose transport answers by operation name, so a hook can be exercised on its own. */
export function givenClient<TDefinition extends ClientDefinition = TestDefinition>(
  answers: Answers,
  calls: Operation[] = [],
) {
  const transport: SuitcaseTransport = {
    async call<TOperation extends Operation>({
      operation,
    }: {
      operation: TOperation;
      input: OperationInput<TOperation>;
    }) {
      calls.push(operation);

      const answer = answers[operation];

      if (answer instanceof Error) throw answer;

      return answer as OperationOutput<TOperation>;
    },
  };

  return createSuitcaseClient<TDefinition>({
    digest: async () => ({ hashAlgorithm: "sha256", hashHex: "0f" }),
    operations: createSuitcaseOperations<TDefinition>({ transport }),
    transfer: async () => {},
  });
}

/** The answers a reusing upload needs, plus whatever the test adds. */
export const reusing = (overrides: Answers = {}): Answers => ({
  "uploads.constraints": { hasIntent: true, maxSize: null, mimeTypes: null },
  "uploads.initialize": reused,
  ...overrides,
});
