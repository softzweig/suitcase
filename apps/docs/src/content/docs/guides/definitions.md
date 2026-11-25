---

title: Defining resources
description: Buckets, owners, reads, uploads, intents, and finalizers.
---

A definition is the whole application contract. It registers buckets, types the execution context,
and declares every resource kind. Services and transports are built from it, so a change to the
definition changes the server API and the client types together.

## The builder

```ts
const definition = Suitcase.withBuckets({
  upload: uploadBucket,
  userAvatars: publicBucket,
  companyDocuments: privateBucket,
})
  .withContext<ExecutionContext>()
  .withResources(({ owner, read, resource }) => {
    // kinds
  });
```

`withBuckets` registers the bucket configs. Every definition needs an `upload` bucket, because an
upload session lives there until it is promoted into the kind's bucket.

`withContext<T>()` is a type only. It declares what `forExecution` receives and what every
authorizer sees as `execution`.

`withResources` is terminal. It receives the factories and returns the resource map.

```ts
type ExecutionContext = Readonly<{
  userId: string;
  isAdmin: boolean;
  companyIds: readonly string[];
}>;
```

## Owners

An owner is declared once and reused by every kind it covers:

```ts
const userOwner = owner({
  schema: z.object({ userId: z.string() }),
  authorize: ({ action, execution, owner }) =>
    execution.isAdmin || execution.userId === owner.userId,
  usage: true,
});

const companyOwner = owner({
  schema: z.object({ companyId: z.string() }),
  authorize: ({ action, execution, owner }) =>
    execution.isAdmin || execution.companyIds.includes(owner.companyId),
});
```

The schema validates the owner shape before the authorizer runs. `authorize` receives the action,
the execution context, the resolved owner, and a transactional copy of the service. It answers for:

- `upload`: starting an upload for this owner;
- `update` and `delete`: mutating a row;
- `usage`: asking how much the owner holds.

`usage: true` opts the kind into usage reporting. Without it, a usage query naming that kind
answers `NOT_FOUND`.

## Kinds

```ts
const kinds = {
  userAvatar: resource("userAvatar", {
    bucket: "userAvatars",
    owner: userOwner,
    read: read({ expose: () => true }),
    upload: userOwner.upload({
      mimeTypes: ["image/png", "image/jpeg"],
      maxSize: "5 MB",
      ownedBy: ({ execution }) => ({ userId: execution.userId }),
    }),
  }),

  companyDocument: resource("companyDocument", {
    bucket: "companyDocuments",
    owner: companyOwner,
    read: read({
      claim: z.object({ companyId: z.string() }),
      verify: ({ claim, execution }) => {
        if (!execution.isAdmin && !execution.companyIds.includes(claim.companyId)) {
          throw ServiceError.forbidden("Not a member of that company");
        }

        return claim;
      },
      expose: ({ requested, scope }) =>
        requested.filter((resource) => resource.metadata?.companyId === scope.companyId),
    }),
    upload: companyOwner.upload({
      mimeTypes: ["application/pdf"],
      maxSize: "10 MB",
      intent: z.object({ companyId: z.string(), folderId: z.string() }),
      ownedBy: ({ claims }) => ({
        companyId: claims.intent.companyId,
      }),
      finalize: ({ asset, intent, owner }) => {
        console.log(`${owner.companyId}/${intent?.folderId}/${asset.key}`);
      },
    }),
  }),
};
```

The single-argument form names the kind after its map key. The two-argument form decouples them:
`userAvatar: resource("userAvatar", definition)` says the map key is `userAvatar` and the stored
kind is also `userAvatar`, while
`avatar: resource("userAvatar", definition)` stores `userAvatar` under the local key `avatar`.

## Reads

An open read decides for the whole kind:

```ts
read({ expose: () => true });
```

A scoped read receives a claim from the caller:

```ts
read({
  claim: z.object({ companyId: z.string() }),
  verify: ({ claim, execution }) => {
    // Refuse, or return the scope the rest of the read may rely on.
    return claim;
  },
  expose: ({ requested, scope }) =>
    requested.filter((resource) => resource.metadata?.companyId === scope.companyId),
});
```

`expose` is called per kind, never per resource, and only with verified claims. It receives every
resource the caller asked for and answers with the ids that caller may have. Anything it omits
resolves to `NOT_FOUND`.

## Uploads

`owner.upload` declares the kind's upload contract:

| Option      | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `mimeTypes` | Accepted MIME types. Omit to accept any.                                          |
| `maxSize`   | Largest accepted file. Accepts a byte count or a parsed operand such as `"5 MB"`. |
| `intent`    | Zod schema for what the client may choose, validated before any hook sees it.     |
| `metadata`  | Zod schema the client metadata claim is parsed against. Omit to accept none.      |
| `decorate`  | Turns the parsed metadata into what the resource stores. Omit to store it as-is.  |
| `ownedBy`   | Required. Derives the owner from the execution context and the claims.            |
| `accept`    | Dynamic policy, such as a quota. Called at initialize and again at finalize.      |
| `finalize`  | Side effects once the resource exists. Its return value is ignored.               |

`ownedBy` is the only place the owner comes from. The client cannot name it, and the session
records the result so finalize does not resolve it again.

### Intent versus metadata

Both are client claims, but they answer different questions and have different lifetimes.

|             | `intent`                                                 | `metadata`                              |
| ----------- | -------------------------------------------------------- | --------------------------------------- |
| Scope       | One upload request                                       | The resource                            |
| Lifetime    | Kept on the upload session, never copied to the resource | Copied from the session to the resource |
| Read by     | `ownedBy`, `accept`, `finalize`                          | Reuse identity, reads, updates          |
| Stored type | The schema output                                        | The decorator output                    |
| Applies to  | Uploads                                                  | Uploads and metadata updates            |

Use `intent` for request-scoped routing and authorization input, such as the tenant or folder this
upload is for. Use `metadata` for data that belongs to the resulting resource, especially when it
participates in deduplication or can change later through `resources.update`.

Do not fold one into the other. Intent may be temporary or sensitive, while metadata is stored,
participates in reuse identity, and can contain server-owned fields. `resources.update` has no
intent, so metadata needs a schema that validates an update independently.

### Metadata

Metadata is opt-in. A kind without a metadata schema refuses any non-null metadata from the
client, though its decorator may still add server-owned fields.

```ts
upload: companyOwner.upload({
  intent: z.object({ companyId: z.string(), folderId: z.string() }),
  metadata: z.object({
    folderId: z.string().max(255),
    source: z.string().max(64),
  }),
  decorate: ({ metadata, owner, execution }) => ({
    ...metadata,
    ownerId: owner.companyId,
    uploadedBy: execution.userId,
  }),
  ownedBy: ({ claims }) => ({ companyId: claims.intent.companyId }),
});
```

The schema types the client claim. The decorator's return type is what the resource stores. When
`decorate` is omitted, the parsed claim is stored as-is, or `null` when the client sends none.
Declare `metadata: z.object({ ... }).optional()` to make the claim itself optional.

`decorate` runs for uploads and metadata updates. Its action is `"upload"` or `"update"`: uploads
also receive the client `claims`, while updates receive the `resource` being changed. The return
value is what gets stored.

Metadata also participates in reuse: identical bytes with different metadata produce a different
resource. `resources.update` runs the same schema and decorator with `action: "update"`.

## Bucket access

`BucketAccessPolicy.PUBLIC` lets a bucket hand out public URLs and skips signing for reads.
`BucketAccessPolicy.PRIVATE` keeps every read behind a signed URL. The policy belongs to the bucket
config, not to a kind:

```ts
const avatars = createMemoryBucketConfig("avatars", { access: BucketAccessPolicy.PUBLIC });
```

## Execution context

The context is what your server knows and the client cannot forge. For a session-based app it might
be `{ userId, isAdmin, companyIds }`. `forExecution` is called once per request with that context,
and every hook and service call for that request sees it.

```ts
const api = server.forExecution({ userId: "u_1", isAdmin: false, companyIds: ["c_1"] });
```

Keep it small and flat. It is passed to every authorizer, so it should contain identity and
authorization facts, not database clients or request objects.

## Export the client type

The server owns the definition. The browser should only know the type it produces. The
`InferSuitcaseClient` helper walks the definition and builds the client contract, and your app gives
that contract a local name:

```ts title="suitcase/definition.ts" {1,15}
import type { InferSuitcaseClient } from "@softzweig/suitcase-server";
import { Suitcase } from "@softzweig/suitcase-server";
import { createMemoryBucketConfig } from "@softzweig/suitcase-server/memory";

export const definition = Suitcase.withBuckets({
  upload: createMemoryBucketConfig("uploads"),
  avatars: createMemoryBucketConfig("avatars"),
})
  .withContext<{ userId: string }>()
  .withResources(({ owner, read, resource }) => {
    // ...
  });

// The browser only needs this alias, never the definition itself.
export type SuitcaseClient = InferSuitcaseClient<typeof definition>;
```

The browser imports the alias with `import type`, never as a value:

```ts title="suitcase/client.ts" {1}
import type { SuitcaseClient } from "./definition.js";
import { createSuitcaseClient } from "@softzweig/suitcase-client";

export const client = createSuitcaseClient<SuitcaseClient>({
  operations,
  transfer,
});
```

The `type` keyword is not cosmetic. TypeScript erases the import, so the definition module and
everything it pulls in never enter the browser graph. A value import keeps that module in the
bundle, which can ship server internals and turn a type mistake into runtime code.

Keep the server package as a dev dependency of the app that consumes the type:

```json title="apps/web/package.json" {5-6}
{
  "dependencies": {
    "@softzweig/suitcase-client": "^0.0.1"
  },
  "devDependencies": {
    "@softzweig/suitcase-server": "^0.0.1"
  }
}
```

This is the browser app's manifest. A server app that runs the definition keeps
`@softzweig/suitcase-server` as a runtime dependency.

With `verbatimModuleSyntax` enabled, TypeScript preserves the difference instead of guessing:

```json title="tsconfig.json" {3}
{
  "compilerOptions": {
    "verbatimModuleSyntax": true
  }
}
```

Now a value import fails to build instead of silently bundling the module. The same rule applies to
every server-only package, including `@softzweig/suitcase-drizzle` and `@softzweig/suitcase-s3`.
Only the inferred type crosses into the browser.

If the browser and server share a package, keep a type-only boundary file so the browser never
imports the definition module directly:

```ts title="suitcase/client-types.ts" {1-2}
import type { InferSuitcaseClient } from "@softzweig/suitcase-server";
import type { definition } from "./definition.js";

export type SuitcaseClient = InferSuitcaseClient<typeof definition>;
```
