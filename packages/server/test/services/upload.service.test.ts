import type { Asset, Resource, UploadSession } from "@softzweig/suitcase-core";
import { AssetStatus, ServiceErrorCode } from "@softzweig/suitcase-core";
import { createNoopJobQueue, type JobQueue } from "@softzweig/suitcase-job-queue";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { z } from "zod";
import type { SuitcaseJobs } from "../../src/jobs.js";
import { createMemoryBucketConfig } from "../../src/memory/index.js";
import { AssetService, type AssetServiceContext } from "../../src/services/asset.service.js";
import {
  ResourceService,
  type ResourceServiceContext,
} from "../../src/services/resource.service.js";
import type { UploadReusePolicy } from "../../src/services/upload.policy.js";
import { UploadService, type UploadServiceContext } from "../../src/services/upload.service.js";
import { UploadCleanupPolicy } from "../../src/storage/storage.bucket.js";
import type { SuitcaseBuckets } from "../../src/storage/storage.buckets.js";
import type { PutObjectInput } from "../../src/storage/storage.operations.js";
import {
  type Definition,
  type InferDefinitionExecutionContext,
  Suitcase,
} from "../../src/suitcase.js";
import { createMemoryRepositories } from "../support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";

/** What a client claims about the file it is about to upload. */
const claims = {
  hashAlgorithm: "sha256",
  hashHex: "a".repeat(64),
  size: 3,
  mimeType: "image/png",
} as const;

const onAuthorize = vi.fn((): boolean => true);
const onAccept = vi.fn((): boolean => true);
const onFinalize = vi.fn();
const onDecorate = vi.fn(
  async ({ metadata, owner }: { metadata: { source: string } | null; owner: { userId: string } }) =>
    ({ ...metadata, ownerId: owner.userId }) as Record<string, unknown>,
);
const onDecorateServer = vi.fn(() => ({ source: "server" }));

/** The owner a user upload is for. */
const onResolveUser = vi.fn(() => ({ userId: "u_1" }));

/** The owner a company upload is for; it sees the claims, but does not need them here. */
const onResolveOwner = vi.fn(() => ({ companyId: "c_1", folder: "root" }));

const createBuckets = (cleanupUploads?: UploadCleanupPolicy) => ({
  [UPLOAD_BUCKET]: {
    ...createMemoryBucketConfig(UPLOAD_BUCKET),
    ...(cleanupUploads ? { cleanupUploads } : {}),
  },
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
});

/**
 * The kinds every test shares: one plain kind, one whose owner comes from the request's company,
 * and one that is never uploaded.
 */
const createDefinition = (buckets: ReturnType<typeof createBuckets>): Definition =>
  Suitcase.withBuckets<SuitcaseBuckets>(buckets).withResources(({ owner, read, resource }) => {
    const user = owner({ schema: z.object({ userId: z.string() }), authorize: onAuthorize });
    const company = owner({
      schema: z.object({ companyId: z.string(), folder: z.string() }),
      authorize: onAuthorize,
    });

    return {
      userAvatar: resource("userAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          intent: z.object({ folderId: z.string() }),
          metadata: z.object({ source: z.string() }),
          mimeTypes: ["image/png"],
          maxSize: "1 KB",
          accept: onAccept,
          ownedBy: onResolveUser,
          finalize: onFinalize,
        }),
      }),
      decoratedAvatar: resource("decoratedAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          metadata: z.object({ source: z.string() }),
          decorate: onDecorate,
          ownedBy: onResolveUser,
          finalize: onFinalize,
        }),
      }),
      serverAvatar: resource("serverAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          decorate: onDecorateServer,
          ownedBy: onResolveUser,
          finalize: onFinalize,
        }),
      }),
      optionalAvatar: resource("optionalAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          metadata: z.object({ source: z.string() }).optional(),
          ownedBy: onResolveUser,
          finalize: onFinalize,
        }),
      }),
      plainAvatar: resource("plainAvatar", {
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({ ownedBy: onResolveUser, finalize: onFinalize }),
      }),
      companyDocument: resource({
        bucket: ASSET_BUCKET,
        owner: company,
        read: read({ expose: () => true }),
        upload: company.upload({
          metadata: z.object({ source: z.string() }),
          ownedBy: onResolveOwner,
          finalize: onFinalize,
        }),
      }),
      privateNote: resource({
        bucket: ASSET_BUCKET,
        owner: user,
        read: read({ expose: () => true }),
      }),
    };
  });

/** A queue that records what it was asked to run, in order, and runs nothing. */
const recordingJobs = () => {
  const enqueued: { name: string; payload: unknown }[] = [];

  const queue: JobQueue<SuitcaseJobs> = {
    ...createNoopJobQueue<SuitcaseJobs>(),
    enqueue: async (name, payload) => void enqueued.push({ name, payload }),
  };

  return { enqueued, queue };
};

/** A service on a fresh in-memory backend, wired the way a server would wire it. */
const givenService = (
  options: Readonly<{
    createUploadKey?: (uploadId: string) => string;
    cleanupUploads?: UploadCleanupPolicy;
  }> = {},
) => {
  const buckets = createBuckets(options.cleanupUploads);
  const definition = createDefinition(buckets);
  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const repositories = {
    assetRepo: assets,
    resourceRepo: resources,
    uploadSessionRepo: uploadSessions,
  };

  const jobs = recordingJobs();
  const assetService = new AssetService<AssetServiceContext>(
    { ...repositories, definition, jobs: jobs.queue, isInTransaction: false },
    transaction,
  );
  const resourceService = new ResourceService<Definition, ResourceServiceContext>(
    { ...repositories, definition, assetService, isInTransaction: false },
    transaction,
  );

  return {
    buckets,
    repositories,
    jobs,
    execution: { buckets: definition.buckets } as InferDefinitionExecutionContext<Definition>,
    service: new UploadService<Definition, UploadServiceContext>(
      {
        ...repositories,
        definition,
        assetService,
        resourceService,
        createUploadKey: options.createUploadKey ?? ((uploadId) => `uploads/${uploadId}`),
        jobs: jobs.queue,
        isInTransaction: false,
      },
      transaction,
    ),
  };
};

type Given = ReturnType<typeof givenService>;

/** What a caller hands `initialize`, so the overrides stay checked against the real signature. */
type StartInput = Parameters<UploadService<Definition, UploadServiceContext>["initialize"]>[0];

/**
 * The claim set a client sends for the fixture kind. The intent is stated explicitly: the erased
 * definition cannot type one, so this is where the test states what the wire carries.
 */
const claimSet = (overrides: Readonly<Record<string, unknown>> = {}) =>
  ({
    ...claims,
    fileName: "cat.png",
    intent: { folderId: "docs" },
    metadata: { source: "test" },
    ...overrides,
  }) as unknown as StartInput["claims"];

/** Starts an upload the way a transport would, with the client's file claims filled in. */
const initializeUpload = ({ service, execution }: Given, overrides: Partial<StartInput> = {}) =>
  service.initialize({
    claims: claimSet(),
    execution,
    kind: "userAvatar",
    reusePolicy: { type: "none" },
    ...overrides,
  });

const finalizeUpload = (
  { service, execution }: Given,
  uploadId: string,
  reusePolicy: UploadReusePolicy = { type: "none" },
) => service.finalize({ execution, reusePolicy, uploadId });

/** A session left in the state another actor put it in, so `finalize` can be tested alone. */
const givenSession = (given: Given, overrides: Partial<UploadSession> = {}) =>
  given.repositories.uploadSessionRepo.insert({
    status: "pending",
    resourceId: null,
    kind: "userAvatar",
    owner: { userId: "u_1" },
    intent: { folderId: "docs" },
    metadata: null,
    ...claims,
    fileName: "cat.png",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });

/** The object the client stored, matching the session's claims. */
const givenUploadedObject = (given: Given, key: string, overrides: Partial<PutObjectInput> = {}) =>
  given.buckets[UPLOAD_BUCKET].storage.put({
    key,
    body: new Uint8Array(claims.size),
    contentType: claims.mimeType,
    checksum: { hashAlgorithm: claims.hashAlgorithm, hashHex: claims.hashHex },
    ...overrides,
  });

/** An asset row holding the session's bytes, in the kind's own bucket. */
const givenAsset = (given: Given, overrides: Partial<Asset> = {}) =>
  given.repositories.assetRepo.insert({
    status: AssetStatus.ACTIVE,
    deletedAt: null,
    bucket: ASSET_BUCKET,
    key: `assets/${crypto.randomUUID()}`,
    ...claims,
    ...overrides,
  });

/** A resource backed by an asset, so an upload can be deduplicated onto it. */
const givenResource = (given: Given, overrides: Partial<Resource> = {}) =>
  given.repositories.resourceRepo.insert({
    assetId: crypto.randomUUID(),
    kind: "userAvatar",
    owner: { userId: "u_1" },
    label: null,
    fileName: "cat.png",
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  });

const sessionOf = (given: Given, uploadId: string) =>
  given.repositories.uploadSessionRepo.findById(uploadId);

beforeEach(() => {
  onAuthorize.mockClear().mockReturnValue(true);
  onAccept.mockClear().mockReturnValue(true);
  onFinalize.mockReset(); // The hook has no default, so a rejecting test must not leak into the next.
  onDecorate.mockClear();
  onDecorateServer.mockClear();
  onResolveUser.mockClear();
  onResolveOwner.mockClear();
});

describe("UploadService", () => {
  describe("initialize", () => {
    it("opens a pending session carrying what the client claimed", async () => {
      const given = givenService();

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: { source: "test" } }),
      }).unwrap();

      expect(result.reused).toBe(false);
      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        ...claims,
        kind: "userAvatar",
        status: "pending",
        fileName: "cat.png",
        metadata: { source: "test" },
        intent: { folderId: "docs" },
        owner: { userId: "u_1" },
        resourceId: null,
        updatedAt: null,
      });
    });

    it("refuses metadata the kind's schema rejects", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, { claims: claimSet({ metadata: { source: 42 } }) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Invalid resource metadata",
      });
    });

    it("refuses omitted metadata when the kind's schema requires it", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, { claims: claimSet({ metadata: undefined }) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Invalid resource metadata",
      });
    });

    it("accepts omitted metadata when the kind's schema allows undefined", async () => {
      const given = givenService();

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: undefined }),
        kind: "optionalAvatar",
      }).unwrap();

      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({ metadata: null });
    });

    it("refuses metadata for a kind that declares no schema", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, {
          claims: claimSet({ metadata: { source: "web" } }),
          kind: "plainAvatar",
        }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Resource kind does not accept metadata",
      });
    });

    it("awaits an async decorator and stores its resolved value", async () => {
      const given = givenService();

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: { source: "web" } }),
        kind: "decoratedAvatar",
      }).unwrap();

      expect(onDecorate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "upload",
          metadata: { source: "web" },
          owner: { userId: "u_1" },
        }),
      );
      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        metadata: { source: "web", ownerId: "u_1" },
      });
    });

    it("stores server-owned metadata without a client schema", async () => {
      const given = givenService();

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: undefined }),
        kind: "serverAvatar",
      }).unwrap();

      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        metadata: { source: "server" },
      });
    });

    it("does not reuse a resource whose metadata differs", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      await givenResource(given, { assetId: asset.id, metadata: { source: "theirs" } });

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: { source: "mine" } }),
        reusePolicy: { type: "auto" },
      }).unwrap();

      expect(result).toMatchObject({ reused: false, target: expect.anything() });
    });

    it("reuses a resource whose metadata matches", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      const resource = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "shared" },
      });

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: { source: "shared" } }),
        reusePolicy: { type: "auto" },
      }).unwrap();

      expect(result).toMatchObject({ reused: true, resource });
    });

    it("reuses using the decorated metadata", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      const resource = await givenResource(given, {
        assetId: asset.id,
        kind: "decoratedAvatar",
        metadata: { source: "shared", ownerId: "u_1" },
      });

      const result = await initializeUpload(given, {
        claims: claimSet({ metadata: { source: "shared" } }),
        kind: "decoratedAvatar",
        reusePolicy: { type: "auto" },
      }).unwrap();

      expect(result).toMatchObject({ reused: true, resource });
    });

    test.for([
      { label: "an hour by default", expiresInSeconds: undefined, seconds: 3600 },
      { label: "the caller's window", expiresInSeconds: 60, seconds: 60 },
    ])("stamps $label", async ({ expiresInSeconds, seconds }) => {
      const given = givenService();

      const result = await initializeUpload(given, { expiresInSeconds }).unwrap();

      const session = await sessionOf(given, result.upload.id);
      const window = Date.parse(session?.expiresAt ?? "") - Date.parse(session?.createdAt ?? "");

      expect(window / 1000).toBe(seconds);
    });

    it("hands the client a presigned URL for the object it is about to upload", async () => {
      const given = givenService();

      const result = await initializeUpload(given).unwrap();

      expect(result).toMatchObject({ reused: false, target: expect.anything() });
    });

    it("refuses claims the kind's intent schema rejects", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, { claims: claimSet({ intent: { folder: "docs" } }) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Invalid upload intent, or outdated (app-update, potentially retry)",
      });
    });

    it("accepts a file exactly at the kind's maximum size", async () => {
      const given = givenService();

      const result = await initializeUpload(given, { claims: claimSet({ size: 1_000 }) }).unwrap();

      expect(result).toMatchObject({ reused: false });
    });

    it("refuses a file over the kind's maximum size", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, { claims: claimSet({ size: 1_001 }) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Upload exceeds maximum size",
      });
    });

    it("refuses an unsupported MIME type", async () => {
      const given = givenService();

      await expect(
        initializeUpload(given, { claims: claimSet({ mimeType: "text/plain" }) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Upload has an unsupported MIME type",
      });
    });

    it("asks the kind whether it accepts this upload, with the owner it resolved", async () => {
      const given = givenService();

      await initializeUpload(given).unwrap();

      expect(onAccept).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: { userId: "u_1" },
          claims: expect.objectContaining({ fileName: "cat.png", size: claims.size }),
        }),
      );
    });

    it("refuses an upload the kind's accept hook rejects", async () => {
      const given = givenService();
      onAccept.mockReturnValue(false);

      await expect(initializeUpload(given).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });

      await expect(given.repositories.uploadSessionRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("drops the session when the owner authorizer denies the upload", async () => {
      const given = givenService();
      onAuthorize.mockReturnValue(false);

      await expect(initializeUpload(given).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });

      // The session is written inside the very transaction the denial rolls back.
      await expect(given.repositories.uploadSessionRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("does not reuse a resource that belongs to another owner", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      await givenResource(given, { assetId: asset.id, owner: { userId: "u_2" } });

      const result = await initializeUpload(given, { reusePolicy: { type: "auto" } }).unwrap();

      expect(result).toMatchObject({ reused: false, target: expect.anything() });
    });

    it("resolves the owner through the kind's contract, claims included", async () => {
      const given = givenService();

      const result = await initializeUpload(given, {
        kind: "companyDocument",
        claims: claimSet({ fileName: "contract.pdf", metadata: { source: "mail" } }),
      }).unwrap();

      expect(onResolveOwner).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: expect.objectContaining({
            fileName: "contract.pdf",
            metadata: { source: "mail" },
          }),
        }),
      );
      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        owner: { companyId: "c_1", folder: "root" },
      });
    });

    it("reauthorizes the upload against the candidate it found", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      const resource = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "test" },
      });

      await initializeUpload(given, { reusePolicy: { type: "exact", asset } }).unwrap();

      expect(onAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "upload",
          candidate: resource,
          owner: { userId: "u_1" },
        }),
      );
    });

    it("reuses the resource the policy points at", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      const resource = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "test" },
      });

      const result = await initializeUpload(given, {
        reusePolicy: { type: "exact", asset },
      }).unwrap();

      expect(result).toMatchObject({ reused: true, resource });
      expect(result).not.toHaveProperty("target");
      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource.id,
      });
    });

    it("reuses the duplicate the asset service finds", async () => {
      const given = givenService();
      const asset = await givenAsset(given);
      const resource = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "test" },
      });

      const result = await initializeUpload(given, { reusePolicy: { type: "auto" } }).unwrap();

      expect(result.reused).toBe(true);
      await expect(sessionOf(given, result.upload.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource.id,
      });
    });

    it("does not reuse an asset a purge claimed", async () => {
      const given = givenService();
      const asset = await givenAsset(given, { status: AssetStatus.PURGING });
      await givenResource(given, { assetId: asset.id });

      const result = await initializeUpload(given, { reusePolicy: { type: "auto" } }).unwrap();

      // The bytes are on their way out, so the caller has to upload them again.
      expect(result).toMatchObject({ reused: false, target: expect.anything() });
    });

    it("still asks for an upload when a duplicate asset has no resource", async () => {
      const given = givenService();
      await givenAsset(given);

      const result = await initializeUpload(given, { reusePolicy: { type: "auto" } }).unwrap();

      expect(result).toMatchObject({ reused: false, target: expect.anything() });
    });

    it("refuses an owner the kind's schema rejects", async () => {
      const given = givenService();
      onResolveUser.mockReturnValueOnce({ userId: 42 } as unknown as { userId: string });

      await expect(initializeUpload(given).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Resource owner does not match the kind's owner schema",
      });

      // The session was written inside the transaction that rejected it.
      await expect(given.repositories.uploadSessionRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("refuses a kind the definition does not declare", async () => {
      const given = givenService();

      await expect(initializeUpload(given, { kind: "ghost" }).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
      });
    });

    it("refuses a kind that is never uploaded", async () => {
      const given = givenService();

      await expect(initializeUpload(given, { kind: "privateNote" }).unwrap()).rejects.toMatchObject(
        {
          code: ServiceErrorCode.NOT_FOUND,
          message: "Resource kind cannot be uploaded",
        },
      );
    });

    it("drops the session when the upload cannot be prepared", async () => {
      const given = givenService({
        createUploadKey: () => {
          throw new Error("no key for you");
        },
      });

      await expect(initializeUpload(given).unwrap()).rejects.toThrow();

      await expect(given.repositories.uploadSessionRepo.findMany({})).resolves.toHaveLength(0);
    });
  });

  describe("finalize", () => {
    it("refuses a session that does not exist", async () => {
      const given = givenService();

      await expect(finalizeUpload(given, crypto.randomUUID()).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
      });
    });

    it("refuses a session another finalize already claimed", async () => {
      const given = givenService();
      const session = await givenSession(given, { status: "processing" });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
      });
    });

    it("refuses a second finalize of a session it already completed", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
      });
    });

    it("lets exactly one of two competing finalizes win", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);

      const settled = await Promise.allSettled([
        finalizeUpload(given, session.id).unwrap(),
        finalizeUpload(given, session.id).unwrap(),
      ]);

      // The claim is what keeps them apart: one drives the session home, the other stops at it.
      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);

      // Whatever the loser did on its way out, the winner's own completion is what stands.
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: expect.any(String),
      });
    });

    it("promotes the upload into the kind's bucket and completes the session", async () => {
      const given = givenService();
      const session = await givenSession(given, { metadata: { source: "test" } });
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      const [asset] = await given.repositories.assetRepo.findMany({ bucket: ASSET_BUCKET });
      expect(asset).toMatchObject({
        ...claims,
        bucket: ASSET_BUCKET,
        key: `uploads/${session.id}`,
        status: AssetStatus.ACTIVE,
        deletedAt: null,
      });
      // The session's own fields stay out of the row, its `id` and `status` among them.
      expect(asset?.id).not.toBe(session.id);

      const [resource] = await given.repositories.resourceRepo.findMany({ kind: "userAvatar" });
      expect(resource).toMatchObject({
        assetId: asset?.id,
        owner: { userId: "u_1" },
        fileName: "cat.png",
        metadata: { source: "test" },
      });

      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource?.id,
      });
    });

    it("queues removal of the upload bucket object once the session completes", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      expect(given.jobs.enqueued).toEqual([
        { name: "uploads.purge", payload: { key: `uploads/${session.id}` } },
      ]);
    });

    it("uses the configured upload key when queuing cleanup", async () => {
      const given = givenService({ createUploadKey: (uploadId) => `pending/${uploadId}` });
      const session = await givenSession(given);
      await givenUploadedObject(given, `pending/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      expect(given.jobs.enqueued).toEqual([
        { name: "uploads.purge", payload: { key: `pending/${session.id}` } },
      ]);
    });

    it("leaves upload cleanup to the bucket lifecycle when configured", async () => {
      const given = givenService({ cleanupUploads: UploadCleanupPolicy.BUCKET_LIFECYCLE });
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      expect(given.jobs.enqueued).toEqual([]);
      await expect(
        given.buckets[UPLOAD_BUCKET].storage.head(`uploads/${session.id}`),
      ).resolves.not.toBeNull();
    });

    it("runs the kind's finalize hook with the owner and intent it decided on", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      expect(onFinalize).toHaveBeenCalledTimes(1);
      expect(onFinalize).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: { userId: "u_1" },
          intent: { folderId: "docs" },
          asset: expect.objectContaining({ bucket: ASSET_BUCKET }),
          resource: expect.objectContaining({ kind: "userAvatar" }),
        }),
      );
    });

    it("leaves the intent out of the hook when the session carries none", async () => {
      const given = givenService();
      const session = await givenSession(given, {
        kind: "companyDocument",
        owner: { companyId: "c_1", folder: "root" },
        intent: null,
      });
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      expect(onFinalize).toHaveBeenCalledWith(expect.objectContaining({ intent: undefined }));
    });

    it("consults the kind's accept hook at each stage of the lifecycle", async () => {
      const given = givenService();
      const started = await initializeUpload(given).unwrap();
      await givenUploadedObject(given, `uploads/${started.upload.id}`);

      await finalizeUpload(given, started.upload.id).unwrap();

      // The kind is asked at initialize and again at finalize, so a quota has to tolerate that.
      expect(onAccept).toHaveBeenCalledTimes(2);
    });

    it("attaches the resource that already holds the bytes instead of promoting again", async () => {
      const given = givenService();
      const session = await givenSession(given);
      const asset = await givenAsset(given);
      const resource = await givenResource(given, { assetId: asset.id });

      await finalizeUpload(given, session.id, { type: "auto" }).unwrap();

      await expect(
        given.repositories.assetRepo.findMany({ bucket: ASSET_BUCKET }),
      ).resolves.toHaveLength(1);
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);

      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource.id,
      });
      expect(onFinalize).toHaveBeenCalledWith(expect.objectContaining({ asset, resource }));
    });

    it("creates a resource when the bytes match but the metadata does not", async () => {
      const given = givenService();
      const session = await givenSession(given, { metadata: { source: "mine" } });
      await givenUploadedObject(given, `uploads/${session.id}`);
      const asset = await givenAsset(given);
      const existing = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "theirs" },
      });

      await finalizeUpload(given, session.id, { type: "auto" }).unwrap();

      const completed = await sessionOf(given, session.id);
      expect(completed).toMatchObject({ status: "completed" });
      expect(completed?.resourceId).not.toBe(existing.id);
      await expect(
        given.repositories.resourceRepo.findMany({ kind: "userAvatar" }),
      ).resolves.toHaveLength(2);
    });

    it("attaches the resource an exact policy points at, without promoting the object", async () => {
      const given = givenService();
      const session = await givenSession(given);
      const asset = await givenAsset(given);
      const resource = await givenResource(given, { assetId: asset.id });

      // No object was ever put in the upload bucket, so only a reuse can complete this session.
      await finalizeUpload(given, session.id, { type: "exact", asset }).unwrap();

      expect(onFinalize).toHaveBeenCalledWith(expect.objectContaining({ asset, resource }));
      await expect(given.repositories.assetRepo.findMany({})).resolves.toHaveLength(1);
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource.id,
      });
    });

    it("attaches the resource an earlier finalize created for the same bytes", async () => {
      const given = givenService();
      const first = await givenSession(given);
      await givenUploadedObject(given, `uploads/${first.id}`);
      await finalizeUpload(given, first.id).unwrap();

      const [resource] = await given.repositories.resourceRepo.findMany({ kind: "userAvatar" });

      const second = await givenSession(given);
      await finalizeUpload(given, second.id, { type: "auto" }).unwrap();

      await expect(given.repositories.assetRepo.findMany({})).resolves.toHaveLength(1);
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);
      await expect(sessionOf(given, second.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: resource?.id,
      });
    });

    it("does not reuse a resource whose asset was recorded with another MIME type", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);
      const asset = await givenAsset(given, { mimeType: "text/plain" });
      const existing = await givenResource(given, {
        assetId: asset.id,
        metadata: { source: "elsewhere" },
      });

      await finalizeUpload(given, session.id, { type: "auto" }).unwrap();

      // The bytes match the duplicate, but the claims it was recorded with do not, so the
      // session is completed onto a resource of its own rather than the one already there.
      const completed = await sessionOf(given, session.id);
      expect(completed).toMatchObject({ status: "completed" });
      expect(completed?.resourceId).not.toBe(existing.id);
      await expect(
        given.repositories.resourceRepo.findMany({ kind: "userAvatar" }),
      ).resolves.toHaveLength(2);
    });

    it("creates a resource of its own when the duplicate has none of the same kind", async () => {
      const given = givenService();
      const session = await givenSession(given);
      const asset = await givenAsset(given);
      await givenResource(given, { assetId: asset.id, kind: "companyDocument" });
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id, { type: "auto" }).unwrap();

      await expect(
        given.repositories.resourceRepo.findMany({ kind: "userAvatar" }),
      ).resolves.toHaveLength(1);
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: expect.any(String),
      });
    });

    it("completes a session of a kind that declares no upload", async () => {
      const given = givenService();
      const session = await givenSession(given, { kind: "privateNote" });
      await givenUploadedObject(given, `uploads/${session.id}`);

      await finalizeUpload(given, session.id).unwrap();

      await expect(
        given.repositories.resourceRepo.findMany({ kind: "privateNote" }),
      ).resolves.toHaveLength(1);
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({ status: "completed" });
      expect(onFinalize).not.toHaveBeenCalled();
    });

    it("keeps the session pending when the owner authorizer denies the upload", async () => {
      const given = givenService();
      const session = await givenSession(given);
      onAuthorize.mockReturnValue(false);

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });

      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "pending",
        resourceId: null,
      });
      await expect(given.repositories.assetRepo.findMany({})).resolves.toHaveLength(0);
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
      expect(onFinalize).not.toHaveBeenCalled();
    });

    it("refuses a session whose owner does not match the kind's schema", async () => {
      const given = givenService();
      const session = await givenSession(given, { owner: { companyId: "c_1" } });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Resource owner does not match the kind's owner schema",
      });
    });

    it("refuses a session whose kind the definition does not declare", async () => {
      const given = givenService();
      const session = await givenSession(given, { kind: "ghost" });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource definition not found",
      });
    });

    it("refuses a session whose window has closed", async () => {
      const given = givenService();
      const session = await givenSession(given, {
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Upload session has expired",
      });
      expect(onFinalize).not.toHaveBeenCalled();
    });

    it("re-verifies the kind's constraints against what the session recorded", async () => {
      const given = givenService();
      const session = await givenSession(given, { size: 1_001 });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Upload exceeds maximum size",
      });
    });

    it("re-verifies the MIME type recorded on the session", async () => {
      const given = givenService();
      const session = await givenSession(given, { mimeType: "text/plain" });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Upload has an unsupported MIME type",
      });
    });

    it("refuses a session whose intent no longer fits the kind's schema", async () => {
      const given = givenService();
      // Written under an older contract: the kind now asks for a folderId.
      const session = await givenSession(given, { intent: { folder: "docs" } });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.PRECONDITION_FAILED,
        message: "Invalid upload intent, or outdated (app-update, potentially retry)",
      });

      await expect(sessionOf(given, session.id)).resolves.toMatchObject({ status: "pending" });
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("refuses an upload the kind's accept hook turns down at finalize", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);
      onAccept.mockReturnValue(false);

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });

      // Both stages consult the hook, so a quota that filled up after initialize still stops it.
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "pending",
        resourceId: null,
      });
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("surfaces a failure from the kind's finalize hook", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);
      onFinalize.mockRejectedValue(new Error("hook exploded"));

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toThrow();

      // The claim is handed back and the resource this attempt created is taken back with it.
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "pending",
        resourceId: null,
      });
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
      // Nothing was cleaned up, so a retry still finds the uploaded object.
      expect(given.jobs.enqueued).toEqual([]);
    });

    it("lets the client finalize again after an attempt failed", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`);
      onFinalize.mockRejectedValueOnce(new Error("hook exploded"));

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toThrow();
      await finalizeUpload(given, session.id).unwrap();

      // The claim went back with the failure, so the same session is claimable a second time.
      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "completed",
        resourceId: expect.any(String),
      });
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);
    });

    it("keeps a resource it reused when the finalize hook fails", async () => {
      const given = givenService();
      const session = await givenSession(given);
      const asset = await givenAsset(given);
      const resource = await givenResource(given, { assetId: asset.id });
      onFinalize.mockRejectedValue(new Error("hook exploded"));

      await expect(finalizeUpload(given, session.id, { type: "auto" }).unwrap()).rejects.toThrow();

      await expect(given.repositories.resourceRepo.findById(resource.id)).resolves.toMatchObject({
        id: resource.id,
      });
    });

    it("keeps a resource an earlier upload created when a later one fails", async () => {
      const given = givenService();
      const first = await givenSession(given);
      await givenUploadedObject(given, `uploads/${first.id}`);
      await finalizeUpload(given, first.id).unwrap();
      const [existing] = await given.repositories.resourceRepo.findMany({});

      // `none` skips deduplication, so the create is what matches the row the first upload made.
      const second = await givenSession(given);
      await givenUploadedObject(given, `uploads/${second.id}`);
      onFinalize.mockRejectedValueOnce(new Error("hook exploded"));

      await expect(finalizeUpload(given, second.id, { type: "none" }).unwrap()).rejects.toThrow();

      await expect(
        given.repositories.resourceRepo.findMany({ kind: "userAvatar" }),
      ).resolves.toMatchObject([{ id: existing?.id }]);
    });

    it("fails when the stored object does not match the session's claims", async () => {
      const given = givenService();
      const session = await givenSession(given);
      await givenUploadedObject(given, `uploads/${session.id}`, { contentType: "text/plain" });

      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toThrow();

      await expect(sessionOf(given, session.id)).resolves.not.toMatchObject({
        status: "completed",
      });
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
    });

    it("keeps the session pending when the client never stored the object", async () => {
      const given = givenService();
      const session = await givenSession(given);

      // The session records what the client claimed, but nothing was ever uploaded for it.
      await expect(finalizeUpload(given, session.id).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Object not found",
      });

      await expect(sessionOf(given, session.id)).resolves.toMatchObject({
        status: "pending",
        resourceId: null,
      });
      await expect(given.repositories.assetRepo.findMany({})).resolves.toHaveLength(0);
      await expect(given.repositories.resourceRepo.findMany({})).resolves.toHaveLength(0);
    });
  });
});
