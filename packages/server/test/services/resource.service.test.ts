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
} from "../../src/services/resource.service.js";
import type { SuitcaseBuckets } from "../../src/storage/storage.buckets.js";
import {
  type Definition,
  type InferDefinitionExecutionContext,
  Suitcase,
} from "../../src/suitcase.js";
import { createMemoryRepositories } from "../support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";
const ASSET_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const RESOURCE_ID = "0b6f6a8a-1f2a-4c1f-9a38-2a5b5c5e6f70";
const OTHER_RESOURCE_ID = "2c7d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
const NOW = "2026-11-14T10:00:00.000Z";

/**
 * Shared across calls: the in-memory repository compares object fields by
 * reference, so a duplicate lookup only matches the same owner value.
 */
const OWNER = { userId: "u_1" };

const ASSET: Asset = {
  id: "7e5a0f6a-1f2a-4c1f-9a38-2a5b5c5e6f70",
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
  assetId: ASSET_ID,
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
  id: overrides.id ?? RESOURCE_ID,
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

/** The parts of a read authorization these tests assert on. */
type ReadCall = {
  context?: unknown;
  execution?: unknown;
  requested: readonly (Resource & { asset: Asset })[];
};

const onOwnerAuthorize = vi.fn((_args: OwnerCall): boolean | string | undefined => undefined);
const onAvatarRead = vi.fn((_args: ReadCall): ResourceReadAuthorization => true);
const onDocumentRead = vi.fn((_args: ReadCall): ResourceReadAuthorization => true);

const bucketConfigs = {
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
};

/** A definition with one context-less kind and one kind that requires read-context. */
const definition: Definition = Suitcase.withBuckets<SuitcaseBuckets>(bucketConfigs).withResources(
  ({ owner, read, resource }) => ({
    userAvatar: resource("userAvatar", {
      owner: owner({ schema: z.object({ userId: z.string() }), authorize: onOwnerAuthorize }),
      read: read({ authorize: onAvatarRead }),
      mimeTypes: ["image/png"],
    }),
    companyDocument: resource({
      owner: owner({ schema: z.object({ companyId: z.string() }), authorize: onOwnerAuthorize }),
      read: read({
        context: z.object({ companyId: z.string() }),
        authorize: onDocumentRead,
      }),
      mimeTypes: ["application/pdf"],
    }),
  }),
);

const execution: InferDefinitionExecutionContext<Definition> = { buckets: bucketConfigs };

/** A definition whose local map key differs from the stored kind (alias form). */
const aliasedDefinition: Definition = Suitcase.withBuckets<SuitcaseBuckets>(
  bucketConfigs,
).withResources(({ owner, read, resource }) => ({
  avatar: resource("userAvatar", {
    owner: owner({ schema: z.object({ userId: z.string() }), authorize: onOwnerAuthorize }),
    read: read({ authorize: onAvatarRead }),
    mimeTypes: ["image/png"],
  }),
}));

/** A resource service on a fresh in-memory backend, plus the rows it writes. */
const givenService = (def: Definition = definition) => {
  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const repositories = {
    assetRepo: assets,
    resourceRepo: resources,
    uploadSessionRepo: uploadSessions,
  };

  const assetService = new AssetService<AssetServiceContext>(
    { ...repositories, definition: def, isInTransaction: false },
    transaction,
  );
  const service = new ResourceService<ResourceServiceContext>(
    { ...repositories, assetService, definition: def, isInTransaction: false },
    transaction,
  );

  return { service, repositories };
};

/** Inserts a resource, letting the in-memory backend generate its id. */
const givenResource = (
  repositories: ReturnType<typeof givenService>["repositories"],
  overrides: Partial<SuitcaseInsert<Resource>> = {},
) => repositories.resourceRepo.insert({ ...resourceData(), ...overrides });

beforeEach(() => {
  onOwnerAuthorize.mockReset().mockReturnValue(undefined);
  onAvatarRead.mockReset().mockReturnValue(true);
  onDocumentRead.mockReset().mockReturnValue(true);
});

describe("ResourceService", () => {
  describe("createOrResource", () => {
    it("creates a resource when none matches", async () => {
      const { service, repositories } = givenService();

      await expect(service.createOrResource(resourceData())).resolves.toMatchObject({
        created: true,
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toMatchObject([
        { assetId: ASSET_ID, kind: "userAvatar", owner: OWNER, metadata: null, label: null },
      ]);
    });

    it("returns the existing resource for an identical request", async () => {
      const { service, repositories } = givenService();
      const existing = await service.createOrResource(resourceData());

      await expect(service.createOrResource(resourceData())).resolves.toEqual({
        created: false,
        resource: existing.resource,
      });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(1);
    });

    it("ignores fields outside the duplicate identity", async () => {
      const { service } = givenService();
      const existing = await service.createOrResource(resourceData());

      await expect(
        service.createOrResource(
          resourceData({ label: "renamed", fileName: "dog.png", updatedAt: NOW }),
        ),
      ).resolves.toEqual({ created: false, resource: existing.resource });
    });

    it("creates a resource for another kind", async () => {
      const { service, repositories } = givenService();
      await expect(service.createOrResource(resourceData())).resolves.toMatchObject({
        created: true,
      });

      await expect(
        service.createOrResource(resourceData({ kind: "companyDocument" })),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });

    it("creates a resource for another owner", async () => {
      const { service, repositories } = givenService();
      await expect(service.createOrResource(resourceData())).resolves.toMatchObject({
        created: true,
      });

      await expect(
        service.createOrResource(resourceData({ owner: { userId: "u_2" } })),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });

    it("creates a resource for different metadata", async () => {
      const { service, repositories } = givenService();
      await expect(
        service.createOrResource(resourceData({ metadata: { tag: 1 } })),
      ).resolves.toMatchObject({ created: true });

      await expect(
        service.createOrResource(resourceData({ metadata: { tag: 2 } })),
      ).resolves.toMatchObject({ created: true });
      await expect(repositories.resourceRepo.findMany({})).resolves.toHaveLength(2);
    });
  });

  describe("update", () => {
    it("patches the row and hands the owner both sides of the change", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);
      const delta = { id: row.id, label: "renamed" };
      const patched = { ...row, label: "renamed" };

      await expect(service.update({ execution, delta })).resolves.toEqual(patched);
      expect(onOwnerAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({
          action: ResourceMutationAction.UPDATE,
          resource: row,
          newResource: patched,
          delta,
          execution,
        }),
      );
    });

    it("reports an unknown id without authorizing", async () => {
      const { service } = givenService();
      const id = crypto.randomUUID();

      await expect(service.update({ execution, delta: { id, label: "x" } })).rejects.toMatchObject({
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
        service.update({ execution, delta: { id: row.id, label: "x" } }),
      ).rejects.toMatchObject({ code: ServiceErrorCode.FORBIDDEN, message });
      await expect(repositories.resourceRepo.findById(row.id)).resolves.toEqual(row);
    });
  });

  describe("delete", () => {
    it("removes and returns the row", async () => {
      onOwnerAuthorize.mockReturnValue(true);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);

      await expect(service.delete({ execution, resourceId: row.id })).resolves.toEqual(row);
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

      await expect(service.delete({ execution, resourceId: id })).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        details: { id },
      });
      expect(onOwnerAuthorize).not.toHaveBeenCalled();
    });

    it("restores the row when the owner denies", async () => {
      onOwnerAuthorize.mockReturnValue(false);
      const { service, repositories } = givenService();
      const row = await givenResource(repositories);

      await expect(service.delete({ execution, resourceId: row.id })).rejects.toMatchObject({
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

  describe("authorizeRead", () => {
    it("allows every requested resource when the read authorizer approves", async () => {
      const { service } = givenService();
      const requested = [
        withAsset(resourceRow()),
        withAsset(resourceRow({ id: OTHER_RESOURCE_ID })),
      ];

      await expect(service.authorizeRead({ execution, requested, contexts: {} })).resolves.toEqual(
        requested,
      );
    });

    it("batches by kind and forwards each kind's context", async () => {
      const { service } = givenService();
      const avatars = [withAsset(resourceRow()), withAsset(resourceRow({ id: OTHER_RESOURCE_ID }))];
      const documents = [withAsset(resourceRow({ kind: "companyDocument" }))];

      await expect(
        service.authorizeRead({
          execution,
          requested: [...avatars, ...documents],
          contexts: { companyDocument: execution },
        }),
      ).resolves.toEqual([...avatars, ...documents]);

      expect(onAvatarRead).toHaveBeenCalledTimes(1);
      expect(onAvatarRead).toHaveBeenCalledWith(
        expect.objectContaining({ requested: avatars, execution }),
      );
      expect(onDocumentRead).toHaveBeenCalledWith(
        expect.objectContaining({ requested: documents, context: execution }),
      );
    });

    it("keeps only the resources explicitly allowed by id", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow({ id: OTHER_RESOURCE_ID }));
      onAvatarRead.mockReturnValue([first.id]);

      await expect(
        service.authorizeRead({ execution, requested: [first, second], contexts: {} }),
      ).resolves.toEqual([first]);
    });

    it("keeps resources an authorizer allows by id object", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow({ id: OTHER_RESOURCE_ID }));
      onAvatarRead.mockReturnValue([{ id: first.id }]);

      await expect(
        service.authorizeRead({ execution, requested: [first, second], contexts: {} }),
      ).resolves.toEqual([first]);
    });

    it("preserves the caller's order across kinds", async () => {
      const { service } = givenService();
      const avatar = withAsset(resourceRow());
      const document = withAsset(resourceRow({ kind: "companyDocument" }));
      const otherAvatar = withAsset(resourceRow({ id: OTHER_RESOURCE_ID }));

      await expect(
        service.authorizeRead({
          execution,
          requested: [avatar, document, otherAvatar],
          contexts: { companyDocument: execution },
        }),
      ).resolves.toEqual([avatar, document, otherAvatar]);
    });

    it("keeps only the resources explicitly allowed by reference", async () => {
      const { service } = givenService();
      const first = withAsset(resourceRow());
      const second = withAsset(resourceRow({ id: OTHER_RESOURCE_ID }));
      onAvatarRead.mockReturnValue([second]);

      await expect(
        service.authorizeRead({ execution, requested: [first, second], contexts: {} }),
      ).resolves.toEqual([second]);
    });

    test.for([false, undefined])(
      "returns nothing when the read authorizer denies (%s)",
      async (denial) => {
        const { service } = givenService();
        onAvatarRead.mockReturnValue(denial);

        await expect(
          service.authorizeRead({ execution, requested: [withAsset(resourceRow())], contexts: {} }),
        ).resolves.toEqual([]);
      },
    );

    it("rejects an undefined kind", async () => {
      const { service } = givenService();

      await expect(
        service.authorizeRead({
          execution,
          requested: [withAsset(resourceRow({ kind: "unknown" }))],
          contexts: {},
        }),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource kind not defined. Forgot to define it in Suitcase?",
        details: { kind: "unknown" },
      });
    });

    it("requires the read-context the kind declares", async () => {
      const { service } = givenService();

      await expect(
        service.authorizeRead({
          execution,
          requested: [withAsset(resourceRow({ kind: "companyDocument" }))],
          contexts: {},
        }),
      ).rejects.toMatchObject({
        code: ServiceErrorCode.NOT_FOUND,
        message: "Resource kind requires read-context for read authorization",
        details: { kind: "companyDocument" },
      });
      expect(onDocumentRead).not.toHaveBeenCalled();
    });
  });
});
