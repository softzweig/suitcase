import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMemoryBucketConfig } from "../src/memory/index.js";
import type { ServerAdapters } from "../src/server.js";
import { createSuitcaseServer } from "../src/server.js";
import { Suitcase } from "../src/suitcase.js";
import { createMemoryRepositories } from "./support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";

/** What the client claims about the file; both tests upload the same one. */
const claims = {
  hashAlgorithm: "sha256",
  hashHex: "a".repeat(64),
  size: 3,
  mimeType: "image/png",
} as const;

/** A server on in-memory everything, wired the way a deployment would wire it. */
const givenServer = (authorize = true) => {
  const buckets = {
    [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
    [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
  };

  const definition = Suitcase.withBuckets(buckets).withResources(({ owner, read, resource }) => {
    const user = owner({ schema: z.object({ userId: z.string() }), authorize: () => authorize });

    return {
      userAvatar: resource("userAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({ ownedBy: () => ({ userId: "u_1" }) }),
      }),
    };
  });

  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const adapters: ServerAdapters = {
    repositories: { assets, resources, uploadSessions },
    transaction,
  };

  return {
    buckets,
    repositories: adapters.repositories,
    api: createSuitcaseServer(definition, adapters).forExecution({ buckets: definition.buckets }),
  };
};

type Given = ReturnType<typeof givenServer>;

const startUpload = ({ api }: Given) =>
  api.uploads.initialize({
    kind: "userAvatar",
    claims: { ...claims, fileName: "cat.png" },
    reusePolicy: { type: "none" },
  });

/** Runs an upload all the way to a resource. */
const givenResource = async (given: Given) => {
  const started = await startUpload(given).unwrap();

  await given.buckets[UPLOAD_BUCKET].storage.put({
    key: `uploads/${started.upload.id}`,
    body: new Uint8Array(claims.size),
    contentType: claims.mimeType,
    checksum: { hashAlgorithm: claims.hashAlgorithm, hashHex: claims.hashHex },
  });

  await given.api.uploads
    .finalize({ uploadId: started.upload.id, reusePolicy: { type: "none" } })
    .unwrap();

  const [session] = await given.repositories.uploadSessions.findMany({ id: started.upload.id });
  const [resource] = await given.repositories.resources.findMany({ id: session?.resourceId ?? "" });
  const [asset] = await given.repositories.assets.findMany({ id: resource?.assetId ?? "" });

  if (!resource || !asset) throw new Error("the upload did not produce a resource with an asset");

  return { session, resource, asset };
};

describe("createSuitcaseServer", () => {
  describe("forExecution", () => {
    it("binds the request's execution without asking for it again", async () => {
      const given = givenServer();

      const started = await startUpload(given).unwrap();

      await expect(
        given.repositories.uploadSessions.findById(started.upload.id),
      ).resolves.toMatchObject({
        status: "pending",
        owner: { userId: "u_1" },
        fileName: "cat.png",
      });
    });

    it("hands the caller the result instead of throwing", async () => {
      const given = givenServer(false);

      // The denial is a value, so a transport decides what it means.
      await expect(startUpload(given)).resolves.toMatchObject({
        ok: false,
        code: ServiceErrorCode.FORBIDDEN,
      });

      await expect(startUpload(given).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });
    });

    it("serves the resource and asset endpoints from the same handle", async () => {
      const given = givenServer();
      const { session, resource, asset } = await givenResource(given);

      expect(session).toMatchObject({ status: "completed", resourceId: resource.id });

      const [download] = await given.api.resources
        .resolve({ requestedIds: [resource.id], claims: {} })
        .unwrap();

      expect(download).toMatchObject({
        ok: true,
        id: resource.id,
        label: null,
        fileName: "cat.png",
      });

      await expect(
        given.api.assets.createDownloadUrl({ asset, expiresInSeconds: 60 }).unwrap(),
      ).resolves.toMatchObject({ type: "signed" });
    });
  });
});
