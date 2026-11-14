import type { Resource } from "@softzweig/suitcase-core";
import { describe, expect, it } from "vitest";
import z from "zod";
import { createMemoryBucketConfig } from "../../src/memory/index.js";
import type { SuitcaseInsert } from "../../src/repository.js";
import { AssetService, type AssetServiceContext } from "../../src/services/asset.service.js";
import {
  ResourceService,
  type ResourceServiceContext,
} from "../../src/services/resource.service.js";
import type { SuitcaseBuckets } from "../../src/storage/storage.buckets.js";
import { type Definition, Suitcase } from "../../src/suitcase.js";
import { createMemoryRepositories } from "../support/memory.js";

const UPLOAD_BUCKET = "upload";
const ASSET_BUCKET = "assets";
const ASSET_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = "2026-11-14T10:00:00.000Z";

/**
 * Shared across calls: the in-memory repository compares object fields by
 * reference, so a duplicate lookup only matches the same owner value.
 */
const OWNER = { userId: "u_1" };

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

const bucketConfigs = {
  [UPLOAD_BUCKET]: createMemoryBucketConfig(UPLOAD_BUCKET),
  [ASSET_BUCKET]: createMemoryBucketConfig(ASSET_BUCKET),
};

/** The definition the resources below belong to. */
const definition: Definition = Suitcase.withBuckets<SuitcaseBuckets>(bucketConfigs).withResources(
  ({ owner, read, resource }) => ({
    userAvatar: resource("userAvatar", {
      owner: owner({ schema: z.object({ userId: z.string() }), authorize: () => true }),
      read: read({ authorize: () => true }),
      mimeTypes: ["image/png"],
    }),
  }),
);

/** A resource service on a fresh in-memory backend, plus the rows it writes. */
const givenService = () => {
  const { assets, resources, uploadSessions, transaction } = createMemoryRepositories();
  const repositories = {
    assetRepo: assets,
    resourceRepo: resources,
    uploadSessionRepo: uploadSessions,
  };

  const assetService = new AssetService<AssetServiceContext>(
    { ...repositories, definition, isInTransaction: false },
    transaction,
  );
  const service = new ResourceService<ResourceServiceContext>(
    { ...repositories, assetService, definition, isInTransaction: false },
    transaction,
  );

  return { service, repositories };
};

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
});
