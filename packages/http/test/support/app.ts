import { createSuitcaseClient, type SuitcaseClient } from "@softzweig/suitcase-client";
import type { Asset } from "@softzweig/suitcase-core";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import {
  createSuitcaseServer,
  type InferSuitcaseClient,
  type ServerAdapters,
  Suitcase,
  type SuitcaseTransactionRunner,
} from "@softzweig/suitcase-server";
import {
  createMemoryBucketConfig,
  type MemoryBucket,
  MemoryRepository,
  MemoryResourceRepository,
  type MemoryStore,
  MemoryUploadSessionRepository,
} from "@softzweig/suitcase-server/memory";
import { z } from "zod";
import { createHttpHandler } from "../../src/handler.js";
import { createHttpTransport } from "../../src/transport.js";

/** The bucket uploads land in before they are promoted; every definition needs one. */
const UPLOAD_BUCKET = "upload";

/** The bucket the resources' assets live in. */
const ASSET_BUCKET = "assets";

/** The signed-in user every request runs as, unless the app is built for another. */
export const DEFAULT_USER_ID = "u_1";

/** One upload bucket and one assets bucket, fresh for every app. */
export const createExampleBuckets = () => ({
  upload: createMemoryBucketConfig(UPLOAD_BUCKET),
  assets: createMemoryBucketConfig(ASSET_BUCKET),
});

export type ExampleBuckets = ReturnType<typeof createExampleBuckets>;

/**
 * A small app: users upload avatars anyone may read, and tenants store invoices that only their
 * own tenant may read. Every authorizer here is a stand-in for the app's real policy.
 *
 * The user comes from the execution context, so ownership is decided per request the way a real
 * deployment decides it from the session behind the request.
 */
export const createExampleDefinition = (buckets: ExampleBuckets) =>
  Suitcase.withBuckets(buckets)
    .withContext<{ readonly userId: string }>()
    .withResources(({ owner, read, resource }) => {
      const user = owner({
        authorize: () => true,
        schema: z.object({ userId: z.string() }),
      });

      return {
        userAvatar: resource("userAvatar", {
          bucket: ASSET_BUCKET,
          owner: user,
          read: read({ expose: () => true }),
          upload: user.upload({
            maxSize: "2 MB",
            mimeTypes: ["image/png"],
            ownedBy: ({ execution }) => ({ userId: execution.userId }),
          }),
        }),

        invoice: resource("invoice", {
          bucket: ASSET_BUCKET,
          owner: user,
          read: read({
            claim: z.object({ tenantId: z.string() }),
            verify: ({ claim }) => claim.tenantId,
            expose: ({ requested, scope }) =>
              requested.filter(({ metadata }) => metadata?.tenantId === scope).map(({ id }) => id),
          }),
          upload: user.upload({
            maxSize: "5 MB",
            mimeTypes: ["application/pdf"],
            intent: z.object({ folderId: z.string() }),
            ownedBy: ({ execution }) => ({ userId: execution.userId }),
          }),
        }),
      };
    });

/** What the server definition looks like; the client's view is derived from it. */
export type ExampleDefinition = ReturnType<typeof createExampleDefinition>;

/** The client's end-to-end view of the same definition, inferred rather than written twice. */
export type ExampleClient = InferSuitcaseClient<ExampleDefinition>;

/** One running app: the client a consumer uses, and what the stack did behind it. */
export interface Stack {
  /** The assets bucket, so a test can look at what a download url points at. */
  readonly assets: MemoryBucket;

  readonly client: SuitcaseClient<ExampleClient>;

  readonly definition: ExampleDefinition;

  /** The most transfers that were ever in flight at once. */
  peakTransfers(): number;

  /** Every target a transfer was asked to put to, in order. */
  readonly transfers: readonly string[];

  /** Who the app's requests run as. */
  readonly user: { userId: string };
}

/** Bytes a browser would hand over, deterministic so two files can share or differ. */
const content = (size: number, seed: number) => {
  const buffer = new ArrayBuffer(size);
  new Uint8Array(buffer).fill(seed);
  return buffer;
};

/** An avatar as a browser would hand it over. */
export const pngFile = (size: number, seed = 7) => ({
  arrayBuffer: async () => content(size, seed),
  name: "cat.png",
  size,
  type: "image/png",
});

/** An invoice as a browser would hand it over. */
export const pdfFile = (size: number, seed = 11) => ({
  arrayBuffer: async () => content(size, seed),
  name: "invoice.pdf",
  size,
  type: "application/pdf",
});

const sha256Hex = async (bytes: ArrayBuffer) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/**
 * The stack, wired the way a deployment wires it: a definition, the real services on whichever
 * adapters were handed in, the HTTP handler, and a client whose transport is that handler. Only
 * the adapters and the client's two environment hooks are stand-ins; every call between them is
 * production code, serialized through `Request`/`Response` as it would cross the wire.
 */
export const createExampleStack = (
  buckets: ExampleBuckets,
  definition: ExampleDefinition,
  adapters: ServerAdapters,
  user: { userId: string },
): Stack => {
  const server = createSuitcaseServer(definition, adapters);
  const handler = createHttpHandler(() => server.forExecution({ userId: user.userId }).operations);

  const transfers: string[] = [];
  let running = 0;
  let peak = 0;

  const client = createSuitcaseClient<ExampleClient>({
    digest: async (bytes) => ({ hashAlgorithm: "sha256", hashHex: await sha256Hex(bytes) }),
    operations: createSuitcaseOperations<ExampleClient>({
      transport: createHttpTransport({
        fetch: (request, init) => handler(new Request(request, init)),
        url: "https://api.test/suitcase",
      }),
    }),
    // The browser's part of a signed upload: PUT the bytes where the target points.
    transfer: async (target, bytes) => {
      if (target.method !== "PUT") throw new Error(`Unexpected method ${target.method}.`);
      if (target.expiresAt === undefined)
        throw new Error("The target does not say when it lapses.");

      transfers.push(target.url);
      running++;
      peak = Math.max(peak, running);

      await buckets.upload.storage.putPresigned(
        { expiresAt: target.expiresAt, headers: target.headers, method: "PUT", url: target.url },
        new Uint8Array(bytes),
      );

      running--;
    },
  });

  return {
    assets: buckets.assets.storage,
    client,
    definition,
    peakTransfers: () => peak,
    transfers,
    user,
  };
};

/** The app on in-memory adapters: no infrastructure, so the fastest way to run the whole flow. */
export const createExampleApp = ({ userId = DEFAULT_USER_ID }: { userId?: string } = {}): Stack => {
  const buckets = createExampleBuckets();
  const definition = createExampleDefinition(buckets);

  const store: MemoryStore = new Map();
  const repositories = {
    assets: new MemoryRepository<Asset>(store, "assets"),
    resources: new MemoryResourceRepository(store),
    uploadSessions: new MemoryUploadSessionRepository(store),
  };

  // One rollback over the shared store, with the handles rebound to the transaction the way a
  // database adapter rebinds them.
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

  return createExampleStack(buckets, definition, { repositories, transaction }, { userId });
};
