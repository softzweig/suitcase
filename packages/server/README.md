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
type ExecutionContext = Readonly<{
  userId: string;
  isAdmin: boolean;
  companyIds: readonly string[];
}>;

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

`owner` authorizers decide whether a mutation may happen: they receive the parsed owner, the
execution context and a transactional copy of the service, discriminated by the action they are
deciding.

`read` decides what a read may hand out. A kind that declares a `claim` receives the caller's
input validated against that schema, then passes it to `verify`, which either refuses or returns
the scope the read may rely on — `expose` never sees an unverified claim. `expose` answers with
`true`, `false`, or the subset that may be handed out.

See `test/suitcase.test.ts` for this definition under test.
