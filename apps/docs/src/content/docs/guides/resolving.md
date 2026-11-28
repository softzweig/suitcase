---

title: Resolving resources
description: Turn resource ids into download links, with claims and per-entry results.
---

Resolving is how the browser gets links. It takes the ids the host already knows about, applies the
kind's read authorization, and answers with one entry per id.

## The request

```ts
const entries = await client.resources.resolve({
  requestedIds: ids,
  claims: { companyId: "c_1" },
});
```

`claims` is keyed by kind. A kind that declares no claim needs no entry.

## The result

`resolve` returns an array in the order asked. Every entry reports its own outcome:

```ts
type ResourceDownload =
  | {
      ok: true;
      id: string;
      label: string | null;
      fileName: string;
      url:
        | { type: "signed"; url: string; expiresAt: string; headers?: Record<string, string> }
        | { type: "public"; url: string };
    }
  | {
      ok: false;
      id: string;
      code: SpindleErrorCode;
    };
```

A failed entry carries only a code. Messages and details would leak infrastructure specifics, and
`not_found` deliberately covers both "does not exist" and "not readable", so a list cannot be used
to discover resources the caller may not see.

## Open reads

```ts
read({ expose: () => true });
```

Every requested id of this kind resolves. This is appropriate for public content such as avatars in
a public bucket.

## Scoped reads

```ts
read({
  claim: z.object({ companyId: z.string() }),
  verify: ({ claim, execution }) => {
    if (!execution.companyIds.includes(claim.companyId)) {
      throw ServiceError.forbidden("Not a member of that company");
    }

    return claim;
  },
  expose: ({ requested, scope }) =>
    requested.filter((resource) => resource.metadata?.companyId === scope.companyId),
});
```

`verify` turns a client claim into a trusted scope, or refuses. `expose` filters the requested
resources with that scope. If the claim is invalid, the whole call fails with `forbidden`. If the
claim is valid but a resource is outside the scope, that entry becomes `not_found`.

## Resolve is not a list operation

Suitcase does not expose `resources.list`. The host queries its own resource table, because only the
host knows the product's filters, sorting, and pagination. Suitcase then authorizes the ids that the
host decided to show.

A typical page does this:

```ts title="app/files/page.ts" {1-4,10-16,19}
import { desc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { resources } from "../schema.js";
import { client } from "../suitcase/client.js";

const page = 0;
const pageSize = 24;

// Your table owns pagination, sorting, and filtering.
const rows = await db
  .select()
  .from(resources)
  .where(eq(resources.ownerUserId, userId))
  .orderBy(desc(resources.createdAt))
  .limit(pageSize)
  .offset(page * pageSize);

// Suitcase only authorizes the ids you decided to show.
const entries = await client.resources.resolve({
  requestedIds: rows.map((row) => row.id),
  claims: {},
});
```

The page, the sort, and the filter are all yours. Suitcase sees only the ids that survived those
choices, and answers with one result per id.

## Batching in React

`useResolveResources` and `useResolveResource` share one batcher per client. A grid of avatars
resolving their own id in the same tick makes one backend call, not one per cell.

```tsx
const { phase, entries } = useResolveResources(client, "companyDocument", {
  contexts: { companyId },
  ids,
});
```

Hooks compare claims by stable serialization, so claims must be plain data. Two claims that serialize
alike share a call. Anything a serializer drops, such as `undefined`, functions, or class instances,
is invisible to that comparison.

## Download URLs

A successful entry carries the URL the storage adapter produced. For a private bucket, that is a
signed URL with an expiry. For a public bucket, it may be a stable public URL. Treat it as short
lived unless the definition says otherwise, and resolve again when it expires.

On S3, every resolve would otherwise sign a new URL. Wrap the bucket in
`CachedDownloadStorageBucket` to reuse a URL while at least half of its TTL remains. See
[Cached download URLs](/suitcase/guides/cached-downloads/).
