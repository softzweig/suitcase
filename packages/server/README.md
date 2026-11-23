# @softzweig/suitcase-server

Definitions, business logic and a server API for Suitcase.

## Defining a suitcase

A definition declares the buckets an application stores objects in, the context the application
supplies to its authorizers, and the resource kinds it stores. A kind is keyed by its local name
and stored under its `kind`; the two-argument `resource(kind, definition)` form decouples the two
when they should differ.

```ts
import z from "zod";
import { Suitcase } from "@softzweig/suitcase-server";
import { createMemoryBucketConfig } from "@softzweig/suitcase-server/memory";
import { ServiceError } from "@softzweig/suitcase-server/services";
import { BucketAccessPolicy } from "@softzweig/suitcase-server/storage";

/** The context the application supplies to every authorizer and resolver. */
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
      authorize: ({ execution, owner }) =>
        execution.isAdmin || execution.companyIds.includes(owner.companyId),
    });

    return {
      // A kind anyone may read, owned by whoever the request runs as.
      userAvatar: resource("userAvatar", {
        bucket: "userAvatars",
        owner: userOwner,
        read: read({ expose: () => true }),
        upload: userOwner.upload({
          mimeTypes: ["image/png", "image/jpeg"],
          maxSize: "5 MB",
          // The owner is never sent by the client, only derived from what the server knows.
          ownedBy: ({ execution }) => ({ userId: execution.userId }),
        }),
      }),

      // A kind read per company, and uploaded into a company the caller chooses.
      companyDocument: resource("companyDocument", {
        bucket: "companyDocuments",
        owner: companyOwner,
        read: read({
          claim: z.object({ companyId: z.string() }),
          verify: ({ claim, execution }) => {
            if (!execution.isAdmin && !execution.companyIds.includes(claim.companyId)) {
              throw new Error("Not a member of that company");
            }

            return claim;
          },
          expose: ({ requested, scope }) =>
            requested.filter((resource) => resource.metadata?.companyId === scope.companyId),
        }),
        upload: companyOwner.upload({
          mimeTypes: ["application/pdf"],
          maxSize: "10 MB",

          // What the client chooses for itself: which company, and which folder inside it. It is
          // validated by this schema, stored on the upload session, and handed to the hooks below.
          intent: z.object({ companyId: z.string(), folderId: z.string() }),

          // Who the document belongs to. Whether this caller may put it there is the owner's
          // authorizer's decision, which runs for uploads like any other mutation.
          ownedBy: ({ claims }) => {
            const intent = claims.intent;

            if (!intent) {
              throw ServiceError.forbidden("An upload intent is required");
            }

            return { companyId: intent.companyId, folder: intent.folderId };
          },

          // Side effects once the resource exists. The intent survived on the session, so the
          // finalizer never has to reconstruct what the client asked for.
          finalize: ({ asset, intent, owner }) => {
            console.log(`${owner.companyId}/${intent?.folderId}/${asset.key}`);
          },
        }),
      }),
    };
  });
```

**Ownership** is decided once, by `ownedBy`, from the execution context and what the client
stated. The session records the result, so `finalize` never re-resolves it, and the client can
never name the owner it uploads for. `ownedBy` is required for an uploadable kind, and it only
answers "who is this for"; whether the caller may act on that owner is the owner authorizer's
decision.

That authorizer runs for uploads the same way it runs for updates and deletes, receiving the
resolved owner, the execution context and the session as the event (`action: "upload"`, the
session, and the candidate resource if one is being reused). That is why `companyOwner` above
checks `companyIds` once and covers both reading a company's documents and uploading into one.

**Intent** is the rest of what the client may choose, anything the execution context cannot say.
It is validated against its schema before any hook sees it, persisted on the session, and passed
to `ownedBy`, `accept` and `finalize`. It is not evidence either; the hooks decide what it is
worth.

**`owner.authorize`** decides mutations on a resource (update, delete) and the start of an upload
into one, receiving the parsed owner, the execution context and a transactional copy of the
service.

**`read`** decides what a read may hand out. A kind declaring a `claim` receives the caller's
input validated against that schema, then passes it to `verify`, which either refuses or returns
the scope the read may rely on. `expose` never sees an unverified claim.

## Using it

```ts
import { ByteSize } from "@softzweig/suitcase-core/utils";
import { createSuitcaseServer } from "@softzweig/suitcase-server";
import { createPostgresServerAdapters } from "@softzweig/suitcase-drizzle/pg-core";

// The definition stays data; repositories, the transaction runner and the upload key naming
// arrive through the adapters, once. `db` is a drizzle instance (pg or sqlite).
const server = createSuitcaseServer(companySuitcase, createPostgresServerAdapters(db));
const api = server.forExecution({
  userId: "u_1",
  isAdmin: false,
  companyIds: ["c_1"],
  buckets: companySuitcase.buckets,
});

// Open a session. The intent says which company, and the owner authorizer refuses a company this
// caller does not belong to.
const started = await api.uploads
  .initialize({
    kind: "companyDocument",
    claims: {
      hashAlgorithm: "sha256",
      hashHex: "...",
      size: ByteSize.parse("68 KB").toBytes(),
      mimeType: "application/pdf",
      fileName: "contract.pdf",
      intent: { companyId: "c_1", folderId: "docs/2026" },
    },
  })
  .unwrap();

// ...the client uploads to `started.presignedUrl`, then:

await api.uploads.finalize({ uploadId: started.upload.id }).unwrap();

// Reads take the same claim the kind declares, never an owner.
await api.resources.resolve({ requestedIds: ["..."], claims: { companyId: "c_1" } }).unwrap();
```

Results come back as `ServiceResult`, so a transport branches on `ok`/`code` or `unwrap()`s at the
edge. See `test/suitcase.test.ts` for the definition above under test, and `test/server.test.ts`
for the API handle.

## Deleting

Deleting is two steps. The resource row goes first, inside the caller's transaction; the asset
behind it is only _marked_, because the bytes may be shared by another resource that was uploaded
with the same content. Marking is also what queues the purge, which is why it happens after that
transaction commits rather than inside it -- the job has to see the mark:

```ts
const server = createSuitcaseServer(companySuitcase, {
  ...createPostgresServerAdapters(db),
  // The server defines the jobs; this only says where they run.
  createJobQueue: (handlers) => createMemoryJobQueue(handlers, { concurrency: 2 }),
});
```

A purge rechecks the mark before removing anything, so a revived or still-shared asset keeps its
bytes and the job ends without doing anything. Without `createJobQueue`, jobs are dropped: the
delete still marks its asset, and the bytes wait for a purge the deployment runs itself.
