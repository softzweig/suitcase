# @softzweig/suitcase-core

The full server business-logic for Suitcase.

## Defining a suitcase

A definition declares the buckets an application stores objects in and the resource kinds
it stores. A resource is keyed by its local name and stored under its `kind`; the
two-argument `resource(kind, definition)` form decouples the two when they should differ,
so `companySuitcase.resources.userAvatar.kind` is `"userAvatar"` while
`companySuitcase.resources.companyDocument.kind` is `"companyDocument"`.

```ts
import z from "zod";
import { BucketAccessPolicy, createMemoryBucketConfig, Suitcase } from "@softzweig/suitcase-server";

/** The context the application supplies to every authorizer. */
type ExecutionContext = Readonly<{ userId: string; isAdmin: boolean }>;

const companySuitcase = Suitcase.withContext<ExecutionContext>()
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
        maxSize: 5 * 1024 * 1024, // 5 MB
      }),
      companyDocument: resource({
        owner: companyOwner,
        read: companyRead,
        mimeTypes: ["application/pdf"],
        maxSize: 10 * 1024 * 1024, // 10 MB
      }),
    };
  });
```

`owner` authorizers receive the parsed owner, the execution context and a transactional
copy of the service, discriminated by the action they are deciding. `read` authorizers
receive the requested resources with their assets plus the read context, and answer with
`true`, `false`, or the subset that may be read. See `test/suitcase.test.ts` for this
definition under test.
