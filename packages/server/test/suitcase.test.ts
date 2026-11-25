import { ByteSize } from "@softzweig/suitcase-core/utils";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createMemoryBucketConfig } from "../src/memory/bucket.js";
import { BucketAccessPolicy } from "../src/storage/storage.access-policy.js";
import {
  type InferDefinitionResourceMetadata,
  type InferDefinitionUsageKinds,
  Suitcase,
} from "../src/suitcase.js";
import type { InferSuitcaseClient } from "../src/transport.js";

/** The context a consuming application supplies to its authorizers. */
type ExecutionContext = Readonly<{
  userId: string;
  isAdmin: boolean;
  companyIds: readonly string[];
}>;

/** What the example's `finalize` hook records, so the wiring stays observable. */
const finalized: string[] = [];

/** The definition the README documents, so the example stays executable. */
const definition = Suitcase.withContext<ExecutionContext>()
  .withBuckets({
    upload: createMemoryBucketConfig("upload"),
    userAvatars: createMemoryBucketConfig("user-avatars", { access: BucketAccessPolicy.PUBLIC }),
    companyDocuments: createMemoryBucketConfig("company-documents"),
  })
  .withResources(({ owner, read, resource }) => {
    const userOwner = owner({
      schema: z.object({ userId: z.string() }),
      authorize: ({ execution, owner }) => execution.isAdmin || execution.userId === owner.userId,
    });

    const companyOwner = owner({
      schema: z.object({ companyId: z.string() }),
      authorize: ({ execution }) => execution.isAdmin,
    });

    const publicRead = read({ expose: () => true });

    // A claim is what the caller says about the read, e.g. which company it is for. It is not
    // evidence: `verify` is what turns it into a scope that `expose` may rely on.
    const companyRead = read({
      claim: z.object({ companyId: z.string() }),
      verify: ({ claim, execution }) => {
        if (!execution.companyIds.includes(claim.companyId)) {
          throw new Error("Not a member of that company");
        }

        return claim;
      },
      expose: ({ requested, scope }) =>
        requested.filter((resource) => resource.metadata?.companyId === scope.companyId),
    });

    return {
      userAvatar: resource("userAvatar", {
        bucket: "userAvatars",
        owner: userOwner,
        read: publicRead,
        upload: userOwner.upload({
          mimeTypes: ["image/png", "image/jpeg"],
          maxSize: "5 MB",
          // The owner is whoever the request runs as; the client never names it.
          ownedBy: ({ execution }) => ({ userId: execution.userId }),
          accept: ({ execution, owner }) =>
            // Technically not needed, authorization is done at the owner-level first.
            // Just serving as an example of additional upload-level checks, where you could
            // check the quota, or any other business rules specific to this upload. ~vz
            execution.isAdmin || execution.userId === owner.userId,
        }),
      }),
      companyDocument: resource({
        bucket: "companyDocuments",
        owner: companyOwner,
        read: companyRead,
        upload: companyOwner.upload({
          // Beyond the owner payload: what the client states about this particular upload.
          intent: z.object({ folderId: z.string() }),
          mimeTypes: ["application/pdf"],
          // The company the request acts for, not one the client names in its intent.
          ownedBy: ({ claims, execution }) => {
            expectTypeOf(claims.intent).toEqualTypeOf<{ folderId: string }>();

            return { companyId: execution.companyIds[0] ?? "" };
          },
          accept: ({ execution, claims }) =>
            execution.isAdmin && claims.intent.folderId.startsWith("docs/"),
          // Side effects once the resource exists: the owner, the asset and the intent apart.
          // The intent is optional here, a session may outlive the parse that produced it.
          finalize: ({ asset, intent, owner, resource }) => {
            finalized.push(`${owner.companyId}/${intent?.folderId}/${resource.kind}/${asset.key}`);
          },
        }),
      }),
    };
  });

describe("Suitcase", () => {
  it("binds a resource to the kind it is stored under", () => {
    expect(definition.resources.userAvatar.kind).toBe("userAvatar");
  });

  it("uses the mapping key as the kind when none is declared", () => {
    expect(definition.resources.companyDocument.kind).toBe("companyDocument");
  });

  it("keeps the buckets the definition declares, and no others", () => {
    expect(Object.keys(definition.buckets)).toEqual(["upload", "userAvatars", "companyDocuments"]);
  });

  it("hands back the bucket configs it was given", () => {
    expect(definition.buckets.upload.storage.getName()).toBe("upload");
    expect(definition.buckets.userAvatars.access).toBe(BucketAccessPolicy.PUBLIC);
  });

  it("keeps maxSize as the author wrote it, ready for ByteSize.parse", () => {
    expect(definition.resources.userAvatar.upload.maxSize).toBe("5 MB");
    expect(ByteSize.parse("5 MB").toBytes()).toBe(5_000_000);
  });

  it("keeps the intent schema the upload declares", () => {
    const { intent } = definition.resources.companyDocument.upload;

    expect(intent?.parse({ folderId: "docs/reports" })).toEqual({ folderId: "docs/reports" });
    expect(() => intent?.parse({ folder: "docs" })).toThrow();
  });

  it("keeps the finalize hook the upload declares", () => {
    expect(definition.resources.companyDocument.upload.finalize).toBeTypeOf("function");
    expect(definition.resources.userAvatar.upload.finalize).toBeUndefined();
  });

  it("infers the stored metadata separately from the client claim", () => {
    const metadataDefinition = Suitcase.withContext<ExecutionContext>().withResources(
      ({ owner }) => {
        const user = owner({ schema: z.object({ userId: z.string() }), authorize: () => true });

        return {
          decorated: {
            bucket: "assets",
            owner: user,
            read: { expose: () => true },
            upload: user.upload({
              metadata: z.object({ caption: z.string() }),
              decorate: ({ metadata, owner }) => ({
                caption: metadata?.caption ?? "",
                ownerId: owner.userId,
              }),
              ownedBy: ({ execution }) => ({ userId: execution.userId }),
            }),
          },
          identity: {
            bucket: "assets",
            owner: user,
            read: { expose: () => true },
            upload: user.upload({
              metadata: z.object({ caption: z.string() }),
              ownedBy: ({ execution }) => ({ userId: execution.userId }),
            }),
          },
          none: {
            bucket: "assets",
            owner: user,
            read: { expose: () => true },
            upload: user.upload({
              ownedBy: ({ execution }) => ({ userId: execution.userId }),
            }),
          },
          optional: {
            bucket: "assets",
            owner: user,
            read: { expose: () => true },
            upload: user.upload({
              metadata: z.object({ caption: z.string() }).optional(),
              ownedBy: ({ execution }) => ({ userId: execution.userId }),
            }),
          },
        };
      },
    );

    type Client = InferSuitcaseClient<typeof metadataDefinition>;
    type Decorated = InferDefinitionResourceMetadata<typeof metadataDefinition, "decorated">;
    type Identity = InferDefinitionResourceMetadata<typeof metadataDefinition, "identity">;
    type None = InferDefinitionResourceMetadata<typeof metadataDefinition, "none">;
    type Optional = InferDefinitionResourceMetadata<typeof metadataDefinition, "optional">;

    expectTypeOf<Client["resources"]["decorated"]["uploadMetadata"]>().toEqualTypeOf<{
      caption: string;
    }>();
    expectTypeOf<Decorated>().toEqualTypeOf<{ caption: string; ownerId: string }>();
    expectTypeOf<Identity>().toEqualTypeOf<{ caption: string } | null>();
    expectTypeOf<None>().toEqualTypeOf<null>();
    expectTypeOf<Client["resources"]["optional"]["uploadMetadata"]>().toEqualTypeOf<
      { caption: string } | undefined
    >();
    expectTypeOf<Optional>().toEqualTypeOf<{ caption: string } | null>();
  });

  it("names only the kinds whose owner reports usage", () => {
    const reporting = Suitcase.withContext<ExecutionContext>().withResources(({ owner }) => {
      const withUsage = owner({
        authorize: () => true,
        schema: z.object({ userId: z.string() }),
        usage: true,
      });
      const withoutUsage = owner({
        authorize: () => true,
        schema: z.object({ userId: z.string() }),
      });

      return {
        avatar: { bucket: "assets", owner: withUsage, read: { expose: () => true } },
        note: { bucket: "assets", owner: withoutUsage, read: { expose: () => true } },
      };
    });

    type UsageKinds = InferDefinitionUsageKinds<typeof reporting>;

    // Exact, so `note` cannot have slipped in; stated as a negative too, because "a kind that does
    // not report usage is not nameable" is the property the definition is actually making.
    expectTypeOf<UsageKinds>().toEqualTypeOf<"avatar">();
    expectTypeOf<"note">().not.toExtend<UsageKinds>();

    // The client is inferred from the same definition, and has to carry the flag to filter by it.
    // The property is optional on a client definition, so the flag itself is what is asserted.
    type Client = InferSuitcaseClient<typeof reporting>;

    expectTypeOf<NonNullable<Client["resources"]["avatar"]["usage"]>>().toEqualTypeOf<true>();
    expectTypeOf<NonNullable<Client["resources"]["note"]["usage"]>>().toEqualTypeOf<false>();
  });
});
