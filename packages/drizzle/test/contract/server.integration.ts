import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { createSuitcaseServer, type ServerAdapters, Suitcase } from "@softzweig/suitcase-server";
import { createMemoryBucketConfig } from "@softzweig/suitcase-server/memory";
import type { SuitcaseRepositories } from "@softzweig/suitcase-server/repository";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";

/** What the client claims about the file; every test uploads the same one. */
const claims = {
  hashAlgorithm: "sha256",
  hashHex: "a".repeat(64),
  size: 4,
  mimeType: "image/png",
} as const;

/** Lets one test refuse the upload from the kind's owner authorizer. */
let authorizeUpload = true;

/**
 * A definition with a single uploadable kind. Storage is in memory on purpose: the database is
 * what these tests exercise, and the buckets are the definition's own business.
 */
const definition = Suitcase.withBuckets({
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
}).withResources(({ owner, read, resource }) => {
  const user = owner({
    schema: z.object({ userId: z.string() }),
    authorize: () => authorizeUpload,
  });

  return {
    userAvatar: resource("userAvatar", {
      bucket: ASSET_BUCKET,
      owner: user,
      read: read({ expose: () => true }),
      upload: user.upload({ mimeTypes: [claims.mimeType], ownedBy: () => ({ userId: "u_1" }) }),
    }),
  };
});

const createServer = (adapters: ServerAdapters) => createSuitcaseServer(definition, adapters);

export type TestServer = {
  /** What the server was handed; the assertions read through the same repositories. */
  readonly adapters: ServerAdapters;
  reset(): Promise<void>;
  close(): Promise<void>;
};

/** What every dialect must give a Suitcase server, run against a real database. */
export const describeServer = (name: string, create: () => Promise<TestServer>) => {
  describe(name, () => {
    let connection: TestServer;
    let server: ReturnType<typeof createServer>;
    let repositories: SuitcaseRepositories;

    beforeAll(async () => {
      connection = await create();
      repositories = connection.adapters.repositories;
      server = createServer(connection.adapters);
    });

    afterAll(() => connection.close());

    beforeEach(async () => {
      await connection.reset();
      authorizeUpload = true;
    });

    const startUpload = () =>
      server.uploads
        .initialize({
          kind: "userAvatar",
          claims: { ...claims, fileName: "cat.png" },
          execution: { buckets: definition.buckets },
          reusePolicy: { type: "none" },
        })
        .unwrap();

    /** The object a client stored for the session it was handed. */
    const givenUploadedObject = (uploadId: string) =>
      definition.buckets[UPLOAD_BUCKET].storage.put({
        key: `uploads/${uploadId}`,
        body: new Uint8Array(claims.size),
        contentType: claims.mimeType,
        checksum: { hashAlgorithm: claims.hashAlgorithm, hashHex: claims.hashHex },
      });

    it("opens a session through the server's own services", async () => {
      const started = await startUpload();

      await expect(repositories.uploadSessions.findById(started.upload.id)).resolves.toMatchObject({
        kind: "userAvatar",
        status: "pending",
        owner: { userId: "u_1" },
        fileName: "cat.png",
      });
    });

    it("only accepts the kinds the definition declares", () => {
      // A compile-time assertion: the server keeps the definition's kinds, so this fails to build.
      const start = (kind: string) =>
        server.uploads.initialize({
          // @ts-expect-error - this definition declares only `userAvatar`
          kind,
          claims: { ...claims, fileName: "cat.png" },
          execution: { buckets: definition.buckets },
          reusePolicy: { type: "none" },
        });

      expect(start).toBeTypeOf("function");
    });

    it("rolls the session back when the kind refuses the upload", async () => {
      authorizeUpload = false;

      await expect(startUpload()).rejects.toMatchObject({ code: ServiceErrorCode.FORBIDDEN });

      // A write on the root connection would survive the denial; a transactional one must not.
      await expect(repositories.uploadSessions.findMany({})).resolves.toHaveLength(0);
    });

    it("finalizes an upload into a resource", async () => {
      const started = await startUpload();
      await givenUploadedObject(started.upload.id);

      await server.uploads
        .finalize({
          execution: { buckets: definition.buckets },
          uploadId: started.upload.id,
          reusePolicy: { type: "none" },
        })
        .unwrap();

      const [asset] = await repositories.assets.findMany({});
      expect(asset).toMatchObject({ ...claims, bucket: ASSET_BUCKET });

      const [resource] = await repositories.resources.findMany({});
      expect(resource).toMatchObject({ assetId: asset?.id, kind: "userAvatar" });

      await expect(repositories.uploadSessions.findById(started.upload.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource?.id,
      });
    });
  });
};
