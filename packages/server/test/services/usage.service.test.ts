import { SpindleErrorCode as ServiceErrorCode } from "@softzweig/spindle-core/result";
import type { UploadStatus } from "@softzweig/suitcase-core";
import { createNoopJobQueue } from "@softzweig/suitcase-job-queue";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMemoryBucketConfig, createMemoryRepositories } from "../../src/memory/index.js";
import { AssetService, type AssetServiceContext } from "../../src/services/asset.service.js";
import {
  ResourceService,
  type ResourceServiceContext,
} from "../../src/services/resource.service.js";
import { toServiceFailure } from "../../src/services/service.result.js";
import { UsageService } from "../../src/services/usage.service.js";
import type { SuitcaseBuckets } from "../../src/storage/storage.buckets.js";
import type { AnyDefinition } from "../../src/suitcase.js";
import { Suitcase } from "../../src/suitcase.js";

/** The definition the tests are built on, erased so the service can be wired generically. */
type TestDefinition = ReturnType<typeof createDefinition>;

/** Everything a test needs: the service, its repositories and the execution it runs as. */
type Given = ReturnType<typeof givenService>;

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";

const createBuckets = () => ({
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
});

/**
 * A user-owned kind, a company-owned one, and a kind whose owner never opted into usage. The
 * authorizers are membership checks on the owner alone, which is all any owner-scoped operation
 * needs: mutations judge the row afterwards, and reading is `read`'s business.
 */
const createDefinition = (buckets: ReturnType<typeof createBuckets>): AnyDefinition =>
  Suitcase.withBuckets<SuitcaseBuckets>(buckets)
    .withContext<{ readonly companyId: string; readonly userId: string }>()
    .withResources(({ owner, read, resource }) => {
      const user = owner({
        authorize: ({ execution, owner }) => owner.userId === execution.userId,
        schema: z.object({ userId: z.string() }),
        usage: true,
      });
      const company = owner({
        // A member of the company may act on what the company holds.
        authorize: ({ execution, owner }) => owner.companyId === execution.companyId,
        schema: z.object({ companyId: z.string() }),
        usage: true,
      });
      const restricted = owner({
        // This owner reports usage, but no execution may look at it.
        authorize: () => "Storage usage is not shared here",
        schema: z.object({ userId: z.string() }),
        usage: true,
      });
      const legacy = owner({ authorize: () => true, schema: z.object({ userId: z.string() }) });

      return {
        userAvatar: resource("userAvatar", {
          bucket: ASSET_BUCKET,
          owner: user,
          read: read({ expose: () => true }),
          upload: user.upload({ ownedBy: ({ execution }) => ({ userId: execution.userId }) }),
        }),
        privateNote: resource({
          bucket: ASSET_BUCKET,
          owner: user,
          read: read({ expose: () => true }),
        }),
        companyDocument: resource({
          bucket: ASSET_BUCKET,
          owner: company,
          read: read({ expose: () => true }),
          upload: company.upload({
            ownedBy: ({ execution }) => ({ companyId: execution.companyId }),
          }),
        }),
        legacyNote: resource({
          bucket: ASSET_BUCKET,
          owner: legacy,
          read: read({ expose: () => true }),
        }),
        restrictedNote: resource({
          bucket: ASSET_BUCKET,
          owner: restricted,
          read: read({ expose: () => true }),
        }),
      };
    });

/** A service on a fresh in-memory backend, wired the way a server would wire it. */
const givenService = () => {
  const buckets = createBuckets();
  const definition = createDefinition(buckets);
  const memory = createMemoryRepositories();

  const repositories = {
    assetRepo: memory.assets,
    resourceRepo: memory.resources,
    uploadSessionRepo: memory.uploadSessions,
  };

  // Wired as a server wires them: the owner authorizer receives the resource service.
  const assetService = new AssetService<AssetServiceContext>(
    {
      ...repositories,
      definition,
      isInTransaction: false,
      jobs: createNoopJobQueue(),
      toServiceFailure,
    },
    memory.transaction,
  );
  const resourceService = new ResourceService<AnyDefinition, ResourceServiceContext>(
    { ...repositories, definition, assetService, isInTransaction: false, toServiceFailure },
    memory.transaction,
  );

  return {
    execution: { buckets: definition.buckets, companyId: "c_1", userId: "u_1" },
    repositories,
    service: new UsageService<TestDefinition>(
      { ...repositories, definition, isInTransaction: false, resourceService, toServiceFailure },
      memory.transaction,
    ),
  };
};

const hash = (seed: string) => ({
  hashAlgorithm: "sha256" as const,
  hashHex: seed.padEnd(64, "a"),
});

/** An asset of `size` bytes and a resource of `kind` pointing at it. */
const givenResource = async (
  given: Given,
  size: number,
  overrides: Readonly<{ kind?: string; owner?: Record<string, string> }> = {},
) => {
  const asset = await given.repositories.assetRepo.insert({
    ...hash(crypto.randomUUID()),
    bucket: ASSET_BUCKET,
    deletedAt: null,
    key: `assets/${crypto.randomUUID()}`,
    mimeType: "image/png",
    size,
    status: "active",
  });

  return given.repositories.resourceRepo.insert({
    assetId: asset.id,
    createdAt: new Date().toISOString(),
    fileName: "cat.png",
    kind: overrides.kind ?? "userAvatar",
    label: null,
    metadata: null,
    owner: overrides.owner ?? { userId: "u_1" },
    updatedAt: null,
  });
};

/** A session reserving `size` bytes, in the state `status` puts it. */
const givenSession = async (
  given: Given,
  size: number,
  overrides: Readonly<{
    kind?: string;
    owner?: Record<string, string>;
    status?: UploadStatus;
  }> = {},
) =>
  given.repositories.uploadSessionRepo.insert({
    ...hash(crypto.randomUUID()),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    fileName: "cat.png",
    intent: null,
    kind: overrides.kind ?? "userAvatar",
    metadata: null,
    mimeType: "image/png",
    owner: overrides.owner ?? { userId: "u_1" },
    resourceId: null,
    size,
    status: overrides.status ?? "pending",
    updatedAt: null,
  });

describe("UsageService", () => {
  /** The one way a caller asks: the kinds to add up, and the owner it is asking about. */
  const usageOf = (given: Given, kinds: string[], owner: Record<string, string | number>) =>
    given.service.usage({ execution: given.execution, kinds, owner }).run();

  it("answers for one kind on its own", async () => {
    const given = givenService();
    await givenResource(given, 100);
    await givenSession(given, 64);

    const usage = await given.service
      .usageOfKind({
        execution: given.execution,
        kind: "userAvatar",
        owner: { userId: "u_1" },
      })
      .run();

    expect(usage).toMatchObject({
      data: {
        resources: { resourceCount: 1, scope: "resource", size: 100 },
        uploads: { scope: "upload", size: 64, uploadCount: 1 },
      },
    });
  });

  it("adds a kind's resources and the uploads that are still in flight", async () => {
    const given = givenService();
    await givenResource(given, 100);
    await givenResource(given, 250);
    await givenSession(given, 64);
    await givenSession(given, 16, { status: "processing" });
    // A finished session's bytes belong to its resource now, so they are not reserved twice.
    await givenSession(given, 4_096, { status: "completed" });

    const usage = await usageOf(given, ["userAvatar"], { userId: "u_1" });

    expect(usage).toMatchObject({
      data: { resourceCount: 2, scope: "total", size: 430, uploadCount: 2 },
    });
  });

  it("adds up every kind it is given", async () => {
    const given = givenService();
    await givenResource(given, 100);
    await givenResource(given, 250, { kind: "privateNote" });
    await givenSession(given, 64, { kind: "privateNote" });

    const usage = await usageOf(given, ["userAvatar", "privateNote"], { userId: "u_1" });

    expect(usage).toMatchObject({
      data: { resourceCount: 2, scope: "total", size: 414, uploadCount: 1 },
    });
  });

  it("authorizes every kind it is given", async () => {
    const given = givenService();
    await givenResource(given, 100);

    const allowed = await usageOf(given, ["userAvatar"], { userId: "u_1" });
    expect(allowed).toMatchObject({ data: { size: 100 } });

    // The same owner, read through a second kind whose owner refuses: one refusal refuses the query.
    const refused = await usageOf(given, ["userAvatar", "restrictedNote"], { userId: "u_1" });
    expect(refused).toMatchObject({ code: ServiceErrorCode.FORBIDDEN, ok: false });
  });

  it("counts only the rows of the owner that was named", async () => {
    const given = givenService();
    await givenResource(given, 100);
    await givenResource(given, 9_000, { owner: { userId: "u_2" } });
    await givenSession(given, 512, { owner: { userId: "u_2" } });

    const usage = await usageOf(given, ["userAvatar"], { userId: "u_1" });

    expect(usage).toMatchObject({ data: { resourceCount: 1, size: 100, uploadCount: 0 } });
  });

  it("keeps one kind out of another's answer", async () => {
    const given = givenService();
    await givenResource(given, 100);
    await givenResource(given, 9_999, { kind: "privateNote" });

    const usage = await usageOf(given, ["userAvatar"], { userId: "u_1" });

    expect(usage).toMatchObject({ data: { resourceCount: 1, size: 100 } });
  });

  it("answers for a company whose member is asking", async () => {
    const given = givenService();
    await givenResource(given, 700, { kind: "companyDocument", owner: { companyId: "c_1" } });

    const usage = await usageOf(given, ["companyDocument"], { companyId: "c_1" });

    expect(usage).toMatchObject({ data: { resourceCount: 1, size: 700 } });
  });

  it("refuses an owner the caller may not look at", async () => {
    const given = givenService();
    await givenResource(given, 100);

    const usage = await usageOf(given, ["userAvatar"], { userId: "u_2" });

    expect(usage).toMatchObject({ code: ServiceErrorCode.FORBIDDEN, ok: false });
  });

  it("refuses an owner that does not fit the kind's schema", async () => {
    const given = givenService();

    const usage = await usageOf(given, ["userAvatar"], { userId: 42 });

    expect(usage).toMatchObject({ code: ServiceErrorCode.INVALID_INPUT, ok: false });
  });

  it("refuses a kind whose owner never opted into usage", async () => {
    const given = givenService();

    const usage = await usageOf(given, ["legacyNote"], { userId: "u_1" });

    expect(usage).toMatchObject({ code: ServiceErrorCode.NOT_FOUND, ok: false });
  });
});
