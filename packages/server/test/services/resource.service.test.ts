import type { Asset, Resource } from "@softzweig/suitcase-core";
import { ServiceErrorCode } from "@softzweig/suitcase-core";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import z from "zod";
import { createMemoryBucketConfig } from "../../src/memory/index.js";
import type { SuitcaseInsert } from "../../src/repository.js";
import { AssetService, type AssetServiceContext } from "../../src/services/asset.service.js";
import {
  ResourceMutationAction,
  type ResourceReadAuthorization,
} from "../../src/services/resource.authorizers.js";
import {
  ResourceService,
  type ResourceServiceContext,
  type ResourceUpdate,
} from "../../src/services/resource.service.js";
import { ServiceError } from "../../src/services/service.error.js";
import type { SuitcaseBuckets } from "../../src/storage/storage.buckets.js";
import {
  type Definition,
  type InferDefinitionExecutionContext,
  Suitcase,
} from "../../src/suitcase.js";
import { createMemoryRepositories } from "../support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";
const NOW = "2026-11-14T10:00:00.000Z";

/**
 * Shared across calls: the in-memory repository compares object fields by
 * reference, so a duplicate lookup only matches the same owner value.
 */
const OWNER = { userId: "u_1" };

const ASSET: Asset = {
  id: crypto.randomUUID(),
  hashHex: "a".repeat(64),
  hashAlgorithm: "sha256",
  size: 42,
  mimeType: "image/png",
  bucket: ASSET_BUCKET,
  key: "assets/cat.png",
};

const resourceData = (
  overrides: Partial<SuitcaseInsert<Resource>> = {},
): SuitcaseInsert<Resource> => ({
  assetId: ASSET.id,
  kind: "userAvatar",
  owner: OWNER,
  label: null,
  fileName: "cat.png",
  metadata: null,
  createdAt: NOW,
  updatedAt: null,
  ...overrides,
});

/** A resource as it would be returned by a repository, without writing one. */
const resourceRow = (overrides: Partial<Resource> = {}): Resource => ({
  ...resourceData(),
  ...overrides,
  id: overrides.id ?? crypto.randomUUID(),
});

const withAsset = (resource: Resource): Resource & { asset: Asset } => ({
  ...resource,
  asset: ASSET,
});

/** The parts of an owner authorization these tests assert on. */
type OwnerCall = {
  action: string;
  resource: Resource;
  newResource?: Resource;
  delta?: Partial<Resource>;
  execution?: unknown;
  owner?: unknown;
  transaction?: unknown;
};

/** The parts of an expose call these tests assert on. */
type ReadCall = {
  scope?: unknown;
  execution?: unknown;
  requested: readonly (Resource & { asset: Asset })[];
};

/** The parts of a claim verification these tests assert on. */
type VerifyCall = { claim?: unknown; execution?: unknown; transaction?: unknown };

const onOwnerAuthorize = vi.fn((_args: OwnerCall): boolean | string | undefined => undefined);
const onAvatarRead = vi.fn((_args: ReadCall): ResourceReadAuthorization => true);
const onDocumentRead = vi.fn((_args: ReadCall): ResourceReadAuthorization => true);
const onDocumentVerify = vi.fn((_args: VerifyCall) => _args.claim);

const bucketConfigs = {
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
};

/** The kinds every definition here declares, on the buckets it is given. */
const givenDefinition = (buckets: SuitcaseBuckets): Definition =>
  Suitcase.withBuckets<SuitcaseBuckets>(buckets).withResources(({ owner, read, resource }) => ({
    userAvatar: resource("userAvatar", {
      owner: owner({ schema: z.object({ userId: z.string() }), authorize: onOwnerAuthorize }),
      read: read({ expose: onAvatarRead }),
      mimeTypes: ["image/png"],
    }),
    companyDocument: resource({
      owner: owner({ schema: z.object({ companyId: z.string() }), authorize: onOwnerAuthorize }),
      read: read({
        claim: z.object({ companyId: z.string() }),
        verify: onDocumentVerify,
        expose: onDocumentRead,
      }),
      mimeTypes: ["application/pdf"],
    }),
  }));

/** A definition with one open kind and one kind whose reads need a verified claim. */
const definition = givenDefinition(bucketConfigs);

/** The same kinds without the bucket the asset rows point at, so signing fails. */
const definitionWithoutAssetBucket = givenDefinition({
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
});

const execution: InferDefinitionExecutionContext<Definition> = { buckets: bucketConfigs };

/** The claim the companyDocument kind requires. */
const companyClaim = { companyId: "c_1" };

/** A definition whose local map key differs from the stored kind (alias form). */
const aliasedDefinition: Definition = Suitcase.withBuckets<SuitcaseBuckets>(
  bucketConfigs,
).withResources(({ owner, read, resource }) => ({
  avatar: resource("userAvatar", {
    owner: owner({ schema: z.object({ userId: z.string() }), authorize: onOwnerAuthorize }),
    read: read({ expose: onAvatarRead }),
    mimeTypes: ["image/png"],
  }),
}));

/** A resource service on a fresh in-memory backend, plus the rows it writes. */
const givenService = (
  def: Definition = definition,
  options: Readonly<{ limit?: number; expirationInSeconds?: number }> = {},
) => {
  const { limit, expirationInSeconds } = options;
  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const repositories = {
    assetRepo: assets,
    resourceRepo: resources,
    uploadSessionRepo: uploadSessions,
  };

  // Both policies stay absent unless a test asks for them, so the service's own defaults
  // are what most of these tests exercise.
  const context = {
    ...repositories,
    definition: def,
    ...(limit !== undefined && { createResolverLimit: () => limit }),
    ...(expirationInSeconds !== undefined && {
      createExpirationInSeconds: () => expirationInSeconds,
    }),
  };

  const assetService = new AssetService<AssetServiceContext>(
    { ...context, isInTransaction: false },
    transaction,
  );
  const service = new ResourceService<ResourceServiceContext>(
    { ...context, assetService, isInTransaction: false },
    transaction,
  );

  return { service, repositories };
};

/** Inserts a resource, letting the in-memory backend generate its id. */
const givenResource = (
  repositories: ReturnType<typeof givenService>["repositories"],
  overrides: Partial<SuitcaseInsert<Resource>> = {},
) => repositories.resourceRepo.insert({ ...resourceData(), ...overrides });

/** Inserts the asset a resource row points at, so the join can find it. */
const givenAsset = (
  repositories: ReturnType<typeof givenService>["repositories"],
  overrides: Partial<Asset> = {},
) => repositories.assetRepo.insert({ ...ASSET, ...overrides });

beforeEach(() => {
  vi.restoreAllMocks();
  onOwnerAuthorize.mockReset().mockReturnValue(undefined);
  onAvatarRead.mockReset().mockReturnValue(true);
  onDocumentRead.mockReset().mockReturnValue(true);
  onDocumentVerify.mockReset().mockImplementation(({ claim }) => claim);
});

describe("ResourceService", () => {
  describe("createOrResource", () => {
    it("creates a resource when none matches", async () => {
      const { service, repositories } = givenService();

      await expect(service.createOrResource(resourceData()).unwrap()).resolves.toMatchObject({
        created: true,
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toMatchObject([
        { assetId: ASSET.id, kind: "userAvatar", owner: OWNER, metadata: null, label: null },
      ]);
    });

    it("returns the existing resource for an identical request", async () => {
      const { service, repositories } = givenService();
      const existing = await givenResource(repositories);

      await expect(service.createOrResource(resourceData()).unwrap()).resolves.toEqual({
        created: false,
        resource: existing,
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);
    });

    it("ignores fields outside the duplicate identity", async () => {
      const { service, repositories } = givenService();
      const existing = await givenResource(repositories);

      await expect(
        service
          .createOrResource(resourceData({ label: "renamed", fileName: "dog.png", updatedAt: NOW }))
          .unwrap(),
      ).resolves.toEqual({ created: false, resource: existing });
    });

    it("creates a resource for another kind", async () => {
      const { service, repositories } = givenService();
      await expect(service.createOrResource(resourceData()).unwrap()).resolves.toMatchObject({
        created: true,
      });

      await expect(
        service
          .createOrResource(resourceData({ kind: "companyDocument", owner: { companyId: "c_1" } }))
          .unwrap(),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });

    it("creates a resource for another owner", async () => {
      const { service, repositories } = givenService();
      await expect(service.createOrResource(resourceData()).unwrap()).resolves.toMatchObject({
        created: true,
      });

      await expect(
        service.createOrResource(resourceData({ owner: { userId: "u_2" } })).unwrap(),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });

    it("creates a resource for different metadata", async () => {
      const { service, repositories } = givenService();
      await expect(
        service.createOrResource(resourceData({ metadata: { tag: 1 } })).unwrap(),
      ).resolves.toMatchObject({ created: true });

      await expect(
        service.createOrResource(resourceData({ metadata: { tag: 2 } })).unwrap(),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });

    it("rejects a kind that is not defined", async () => {
      const { service, repositories } = givenService();

      await expect(
        service.createOrResource(resourceData({ kind: "unlisted" })).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.INVALID_INPUT,
        message: "Resource kind not defined. Forgot to define it in Suitcase?",
        details: { kind: "unlisted" },
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toEqual([]);
    });

    it("rejects an owner that does not match the kind's schema", async () => {
      const { service, repositories } = givenService();

      await expect(
        service.createOrResource(resourceData({ kind: "companyDocument" })).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.INVALID_INPUT,
        message: "Resource owner does not match the kind's owner schema",
        details: { kind: "companyDocument" },
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toEqual([]);
    });
  });

  describe("update", () => {
    it("patches the row and hands the owner both sides of the change", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);
      const delta = { id: row.id, label: "renamed" };
      const patched = { ...row, label: "renamed" };

      await expect(service.update({ execution, delta }).unwrap()).resolves.toEqual(patched);
      expect(onOwnerAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ResourceMutationAction.UPDATE,
          resource: row,
          newResource: patched,
          delta: { label: "renamed" },
          execution,
        }),
      );
    });

    it("ignores identity fields a caller smuggles into the delta", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);
      const delta = { id: row.id, kind: "companyDocument" } as ResourceUpdate;

      await expect(service.update({ execution, delta }).unwrap()).resolves.toEqual(row);
      await expect(repositories.resourceRepo.findById(row.id)).resolves.toMatchObject({
        kind: "userAvatar",
      });
    });

    it("reports an unknown id without authorizing", async () => {
      const { service } = givenService();
      const id = crypto.randomUUID();

      await expect(
        service.update({ execution, delta: { id, label: "x" } }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        details: { id },
      });
      expect(onOwnerAuthorize).not.toHaveBeenCalled();
    });

    test.for([
      { result: false, message: "Action not permitted (authorization failed)" },
      { result: "not yours" as const, message: "Action not permitted: not yours" },
    ])("rolls the patch back when the owner denies ($result)", async ({ result, message }) => {
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);
      onOwnerAuthorize.mockReturnValue(result);

      await expect(
        service.update({ execution, delta: { id: row.id, label: "x" } }).unwrap(),
      ).rejects.toMatchObject({ code: ServiceErrorCode.FORBIDDEN, message });
      await expect(repositories.resourceRepo.findById(row.id)).resolves.toEqual(row);
    });
  });

  describe("delete", () => {
    it("removes and returns the row", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);

      await expect(service.delete({ execution, resourceId: row.id }).unwrap()).resolves.toEqual(
        row,
      );
      await expect(repositories.resourceRepo.findById(row.id)).resolves.toBeNull();
      expect(onOwnerAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ResourceMutationAction.DELETE,
          resource: row,
          execution,
        }),
      );
    });

    it("reports an unknown id without authorizing", async () => {
      const { service } = givenService();
      const id = crypto.randomUUID();

      await expect(service.delete({ execution, resourceId: id }).unwrap()).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        details: { id },
      });
      expect(onOwnerAuthorize).not.toHaveBeenCalled();
    });

    it("restores the row when the owner denies", async () => {
      onOwnerAuthorize.mockReturnValue(false);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);

      await expect(
        service.delete({ execution, resourceId: row.id }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
      });
      await expect(repositories.resourceRepo.findById(row.id)).resolves.toEqual(row);
    });
  });

  describe("authorizeMutation", () => {
    const event = (resource: Resource) =>
      ({ action: ResourceMutationAction.UPLOAD, resource }) as const;

    it("passes when the owner authorizer approves", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service } = givenService();
      const resource = resourceRow();

      await expect(
        service.authorizeMutation({ execution, event: event(resource) }).unwrap(),
      ).resolves.toBeUndefined();
      expect(onOwnerAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ResourceMutationAction.UPLOAD,
          resource,
          owner: OWNER,
          execution,
          transaction: expect.objectContaining({
            isInTransaction: false,
            resourceService: service,
          }),
        }),
      );
    });

    it("rejects a resource whose owner does not match the kind's schema", async () => {
      const { service } = givenService();
      const resource = resourceRow({ owner: { companyId: "c_1" } });

      await expect(
        service.authorizeMutation({ execution, event: event(resource) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Resource owner does not match the kind's owner schema",
      });
      expect(onOwnerAuthorize).not.toHaveBeenCalled();
    });

    it("finds a kind whose local map key is an alias", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service } = givenService(aliasedDefinition);

      await expect(
        service.authorizeMutation({ execution, event: event(resourceRow()) }).unwrap(),
      ).resolves.toBeUndefined();
      expect(onOwnerAuthorize).toHaveBeenCalled();
    });

    it("rejects an unknown kind without authorizing", async () => {
      const { service } = givenService();
      const resource = resourceRow({ kind: "unknown" });

      await expect(
        service.authorizeMutation({ execution, event: event(resource) }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Resource kind has no owner. Forgot to define it in Suitcase?",
        details: { id: resource.id, kind: "unknown" },
      });
      expect(onOwnerAuthorize).not.toHaveBeenCalled();
    });

    test.for([
      { result: false, message: "Action not permitted (authorization failed)" },
      { result: undefined, message: "Action not permitted (authorization failed)" },
      { result: "not yours" as const, message: "Action not permitted: not yours" },
    ])("rejects when the owner denies ($result)", async ({ result, message }) => {
      onOwnerAuthorize.mockReturnValue(result);
      const { service } = givenService();

      await expect(
        service.authorizeMutation({ execution, event: event(resourceRow()) }).unwrap(),
      ).rejects.toMatchObject({ code: ServiceErrorCode.FORBIDDEN, message });
    });
  });

  describe("listReadable", () => {
    it("returns the readable resources with their assets attached", async () => {
      const { service, repositories } = givenService();
      const asset = await givenAsset(repositories);
      const first = await givenResource(repositories);
      const denied = await givenResource(repositories);
      onAvatarRead.mockReturnValue([first.id]);

      await expect(
        service
          .listReadable({ execution, requestedIds: [first.id, denied.id], claims: {} })
          .unwrap(),
      ).resolves.toMatchObject([{ id: first.id, asset: { id: asset.id } }]);
    });

    it("requires the claim a kind declares", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const document = await givenResource(repositories, { kind: "companyDocument" });

      await expect(
        service.listReadable({ execution, requestedIds: [document.id], claims: {} }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource kind requires a claim for read authorization",
      });
      expect(onDocumentVerify).not.toHaveBeenCalled();
    });

    it("drops resources whose asset row is gone", async () => {
      const { service, repositories } = givenService();
      const orphan = await givenResource(repositories);

      await expect(
        service.listReadable({ execution, requestedIds: [orphan.id], claims: {} }).unwrap(),
      ).resolves.toEqual([]);
    });
  });

  describe("resolve", () => {
    it("resolves a readable resource into an entry with its naming and link", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const resource = await givenResource(repositories);

      const [entry] = await service
        .resolve({ execution, requestedIds: [resource.id], claims: {} })
        .unwrap();

      expect(entry).toMatchObject({
        ok: true,
        id: resource.id,
        label: null,
        fileName: "cat.png",
        url: { type: "signed" },
      });
    });

    it("reports an unknown id as not found", async () => {
      const { service } = givenService();
      const missing = crypto.randomUUID();

      await expect(
        service.resolve({ execution, requestedIds: [missing], claims: {} }).unwrap(),
      ).resolves.toEqual([{ ok: false, id: missing, code: ServiceErrorCode.NOT_FOUND }]);
    });

    it("reports an unreadable resource exactly like a missing one", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const resource = await givenResource(repositories);
      onAvatarRead.mockReturnValue(false);

      await expect(
        service.resolve({ execution, requestedIds: [resource.id], claims: {} }).unwrap(),
      ).resolves.toEqual([{ ok: false, id: resource.id, code: ServiceErrorCode.NOT_FOUND }]);
    });

    it("reports a resource whose asset row is gone as not found", async () => {
      const { service, repositories } = givenService();
      const orphan = await givenResource(repositories);

      await expect(
        service.resolve({ execution, requestedIds: [orphan.id], claims: {} }).unwrap(),
      ).resolves.toEqual([{ ok: false, id: orphan.id, code: ServiceErrorCode.NOT_FOUND }]);
    });

    it("answers with unresolved entries only, instead of failing the call", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const unreadable = await givenResource(repositories);
      const missing = crypto.randomUUID();
      onAvatarRead.mockReturnValue(false);

      await expect(
        service.resolve({ execution, requestedIds: [unreadable.id, missing], claims: {} }).unwrap(),
      ).resolves.toEqual([
        { ok: false, id: unreadable.id, code: ServiceErrorCode.NOT_FOUND },
        { ok: false, id: missing, code: ServiceErrorCode.NOT_FOUND },
      ]);
    });

    it("keeps the entries in requested order across kinds", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const document = await givenResource(repositories, { kind: "companyDocument" });
      const avatar = await givenResource(repositories);

      await expect(
        service
          .resolve({
            execution,
            requestedIds: [document.id, avatar.id],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).resolves.toMatchObject([
        { ok: true, id: document.id },
        { ok: true, id: avatar.id },
      ]);
    });

    it("collapses a repeated id into a single entry", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const resource = await givenResource(repositories);

      const entries = await service
        .resolve({ execution, requestedIds: [resource.id, resource.id], claims: {} })
        .unwrap();

      expect(entries).toHaveLength(1);
      expect(entries).toMatchObject([{ ok: true, id: resource.id }]);
    });

    it("rejects a request over the configured limit", async () => {
      const { service, repositories } = givenService(definition, { limit: 2 });
      await givenAsset(repositories);
      const first = await givenResource(repositories);
      const second = await givenResource(repositories);
      const third = await givenResource(repositories);

      await expect(
        service
          .resolve({ execution, requestedIds: [first.id, second.id, third.id], claims: {} })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.INVALID_INPUT,
        message: "Cannot resolve more than 2 resources at once.",
        details: { actual: 3, limit: 2 },
      });
    });

    it("falls back to the default limit when the context supplies none", async () => {
      const { service } = givenService();
      const requestedIds = Array.from({ length: ResourceService.DEFAULT_RESOLVE_LIMIT + 1 }, () =>
        crypto.randomUUID(),
      );

      await expect(
        service.resolve({ execution, requestedIds, claims: {} }).unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.INVALID_INPUT,
        details: { actual: requestedIds.length, limit: ResourceService.DEFAULT_RESOLVE_LIMIT },
      });
    });

    it("signs each link with the expiration the context supplies", async () => {
      const { service, repositories } = givenService(definition, { expirationInSeconds: 60 });
      await givenAsset(repositories);
      const resource = await givenResource(repositories);
      const signLink = vi.spyOn(bucketConfigs[ASSET_BUCKET].storage, "createDownloadUrl");

      await expect(
        service.resolve({ execution, requestedIds: [resource.id], claims: {} }).unwrap(),
      ).resolves.toMatchObject([{ ok: true, id: resource.id }]);

      expect(signLink).toHaveBeenCalledWith(expect.objectContaining({ expiresInSeconds: 60 }));
    });

    it("reports a link that cannot be signed instead of failing the call", async () => {
      const { service, repositories } = givenService(definitionWithoutAssetBucket);
      await givenAsset(repositories);
      const resource = await givenResource(repositories);

      await expect(
        service.resolve({ execution, requestedIds: [resource.id], claims: {} }).unwrap(),
      ).resolves.toMatchObject([
        { ok: false, id: resource.id, code: ServiceErrorCode.PRECONDITION_FAILED },
      ]);
    });

    it("keeps the links that do sign when a sibling cannot", async () => {
      const { service, repositories } = givenService();
      await givenAsset(repositories);
      const brokenAsset = await givenAsset(repositories, {
        id: crypto.randomUUID(),
        bucket: "undeclared",
      });
      const resolvable = await givenResource(repositories);
      const broken = await givenResource(repositories, { assetId: brokenAsset.id });

      await expect(
        service
          .resolve({ execution, requestedIds: [resolvable.id, broken.id], claims: {} })
          .unwrap(),
      ).resolves.toMatchObject([
        { ok: true, id: resolvable.id },
        { ok: false, id: broken.id, code: ServiceErrorCode.PRECONDITION_FAILED },
      ]);
    });
  });

  describe("filterReadable", () => {
    it("allows every requested resource when the kind exposes everything", async () => {
      const { service } = givenService();
      const requested = [withAsset(resourceRow()), withAsset(resourceRow())];

      await expect(
        service.filterReadable({ execution, requested, claims: {} }).unwrap(),
      ).resolves.toEqual(requested);
    });

    it("batches by kind and verifies each kind's claim once", async () => {
      const { service } = givenService();
      const avatars = [withAsset(resourceRow()), withAsset(resourceRow())];
      const documents = [withAsset(resourceRow({ kind: "companyDocument" }))];

      await expect(
        service
          .filterReadable({
            execution,
            requested: [...avatars, ...documents],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).resolves.toEqual([...avatars, ...documents]);

      expect(onAvatarRead).toHaveBeenCalledTimes(1);
      expect(onAvatarRead).toHaveBeenCalledWith(
        expect.objectContaining({ requested: avatars, execution }),
      );
      expect(onDocumentVerify).toHaveBeenCalledTimes(1);
      expect(onDocumentVerify).toHaveBeenCalledWith(
        expect.objectContaining({ claim: companyClaim, execution }),
      );
      expect(onDocumentRead).toHaveBeenCalledWith(
        expect.objectContaining({ requested: documents, scope: companyClaim }),
      );
    });

    it("hands expose the verified scope, not the claim", async () => {
      const { service } = givenService();
      const document = withAsset(resourceRow({ kind: "companyDocument" }));
      onDocumentVerify.mockReturnValue({ companyId: "verified" });

      await expect(
        service
          .filterReadable({
            execution,
            requested: [document],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).resolves.toEqual([document]);

      expect(onDocumentRead).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { companyId: "verified" } }),
      );
    });

    it("exposes nothing when the claim cannot be verified", async () => {
      const { service } = givenService();
      const document = withAsset(resourceRow({ kind: "companyDocument" }));
      onDocumentVerify.mockImplementation(() => {
        throw new ServiceError(ServiceErrorCode.FORBIDDEN, "Not a member of that company");
      });

      await expect(
        service
          .filterReadable({
            execution,
            requested: [document],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.FORBIDDEN,
        message: "Not a member of that company",
      });
      expect(onDocumentRead).not.toHaveBeenCalled();
    });

    it("keeps only the resources explicitly allowed by id", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow());
      onAvatarRead.mockReturnValue([first.id]);

      await expect(
        service.filterReadable({ execution, requested: [first, second], claims: {} }).unwrap(),
      ).resolves.toEqual([first]);
    });

    it("keeps resources an authorizer allows by id object", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow());
      onAvatarRead.mockReturnValue([{ id: first.id }]);

      await expect(
        service.filterReadable({ execution, requested: [first, second], claims: {} }).unwrap(),
      ).resolves.toEqual([first]);
    });

    it("preserves the caller's order across kinds", async () => {
      const { service } = givenService();
      const avatar = withAsset(resourceRow());
      const document = withAsset(resourceRow({ kind: "companyDocument" }));
      const otherAvatar = withAsset(resourceRow());

      await expect(
        service
          .filterReadable({
            execution,
            requested: [avatar, document, otherAvatar],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).resolves.toEqual([avatar, document, otherAvatar]);
    });

    it("keeps only the resources explicitly allowed by reference", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow());
      onAvatarRead.mockReturnValue([second]);

      await expect(
        service.filterReadable({ execution, requested: [first, second], claims: {} }).unwrap(),
      ).resolves.toEqual([second]);
    });

    test.for([false, undefined])(
      "returns nothing when a kind exposes nothing (%s)",
      async (denial) => {
        const { service } = givenService();
        onAvatarRead.mockReturnValue(denial);

        await expect(
          service
            .filterReadable({ execution, requested: [withAsset(resourceRow())], claims: {} })
            .unwrap(),
        ).resolves.toEqual([]);
      },
    );

    it("rejects an undefined kind", async () => {
      const { service } = givenService();

      await expect(
        service
          .filterReadable({
            execution,
            requested: [withAsset(resourceRow({ kind: "unknown" }))],
            claims: {},
          })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource kind not defined. Forgot to define it in Suitcase?",
        details: { kind: "unknown" },
      });
    });

    it("requires the claim the kind declares", async () => {
      const { service } = givenService();

      await expect(
        service
          .filterReadable({
            execution,
            requested: [withAsset(resourceRow({ kind: "companyDocument" }))],
            claims: {},
          })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource kind requires a claim for read authorization",
        details: { kind: "companyDocument" },
      });
      expect(onDocumentVerify).not.toHaveBeenCalled();
      expect(onDocumentRead).not.toHaveBeenCalled();
    });

    it("rejects a claim that does not match the kind's schema", async () => {
      const { service } = givenService();

      await expect(
        service
          .filterReadable({
            execution,
            requested: [withAsset(resourceRow({ kind: "companyDocument" }))],
            claims: { companyDocument: { companyId: 1 } },
          })
          .unwrap(),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.INVALID_INPUT,
        message: "Resource claim does not match the kind's schema",
        details: { kind: "companyDocument" },
      });
      expect(onDocumentVerify).not.toHaveBeenCalled();
      expect(onDocumentRead).not.toHaveBeenCalled();
    });

    it("does not let one kind's expose vouch for another kind's resource", async () => {
      const { service } = givenService();
      const avatar = withAsset(resourceRow());
      const document = withAsset(resourceRow({ kind: "companyDocument" }));
      onAvatarRead.mockReturnValue([avatar.id, document.id]);
      onDocumentRead.mockReturnValue(false);

      await expect(
        service
          .filterReadable({
            execution,
            requested: [avatar, document],
            claims: { companyDocument: companyClaim },
          })
          .unwrap(),
      ).resolves.toEqual([avatar]);
    });
  });
});
