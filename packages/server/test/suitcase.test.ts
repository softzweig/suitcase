import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createMemoryBucketConfig } from "../src/memory/bucket.js";
import { BucketAccessPolicy } from "../src/storage/storage.access-policy.js";
import { Suitcase } from "../src/suitcase.js";

/** The context a consuming application supplies to its authorizers. */
type ExecutionContext = Readonly<{
  userId: string;
  isAdmin: boolean;
}>;

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

    const publicRead = read({ authorize: () => true });

    // A read context is what a caller supplies to scope a read, e.g. a company
    const companyRead = read({
      context: z.object({ companyId: z.string() }),
      authorize: ({ requested, context }) =>
        requested.filter((resource) => resource.metadata?.companyId === context.companyId),
    });

    return {
      userAvatar: resource("userAvatar", {
        owner: userOwner,
        read: publicRead,
        mimeTypes: ["image/png", "image/jpeg"],
        maxSize: 5 * 1024 * 1024,
      }),
      companyDocument: resource({
        owner: companyOwner,
        read: companyRead,
        mimeTypes: ["application/pdf"],
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
});
