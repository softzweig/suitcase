---

title: server
description: Definitions, services, the server API, and the ports.
---

`@softzweig/suitcase-server` owns the business logic. It defines what a suitcase is, authorizes
operations, and exposes a typed API per request.

## Create a server

```ts title="suitcase/server.ts" {3,7,9-10}
import { createSuitcaseServer } from "@softzweig/suitcase-server";
import { createHttpHandler } from "@softzweig/suitcase-http/server";
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";
import { definition } from "./definition.js";
import { db } from "./db.js";

export const server = createSuitcaseServer(definition, createSqliteServerAdapters(db));

export const handleSuitcase = createHttpHandler(
  (request) =>
    server.forExecution({ userId: request.headers.get("x-user") ?? "anonymous" }).operations,
);
```

`createSuitcaseServer` takes the definition and the adapters. `forExecution` binds the request's
identity, and `createHttpHandler` exposes the operations as POST endpoints.

`adapters` supplies repositories, a transaction runner, an optional upload key strategy, and an
optional job queue. The definition never carries those.

## Bind an execution

```ts
const api = server.forExecution({ userId: "u_1", isAdmin: false, companyIds: ["c_1"] });
```

`forExecution` closes over the context. Every hook and operation for that request sees it, and
nothing below the API has to pass it around.

The returned API has:

| Namespace    | Operations                              |
| ------------ | --------------------------------------- |
| `operations` | The flat, transport-ready operations    |
| `uploads`    | `constraints`, `initialize`, `finalize` |
| `resources`  | `resolve`, `update`, `delete`           |
| `usage`      | `total`                                 |
| `assets`     | Asset-level operations                  |

## Definitions

`Suitcase` is the builder. See [Defining resources](/suitcase/guides/definitions/).

```ts
const definition = Suitcase.withBuckets({ upload, avatars })
  .withContext<{ userId: string }>()
  .withResources(({ owner, read, resource }) => {
    // ...
  });
```

The package also exports `InferSuitcaseClient`, a type that describes the browser client. Export an
alias from your definition module and import it with `import type`. See
[Export the client type](/suitcase/guides/definitions/#export-the-client-type).

## Results

Every operation returns a `ServiceExecution`. Call `run()` to branch on `ok`/`code`, or `unwrap()`
at the edge to throw. Nothing runs until one of them is called, so an execution that is never
needed costs nothing.

```ts
const result = await api.resources.resolve({ requestedIds, claims: {} }).run();
if (!result.ok) throw new Error(result.message);
```

## In-memory adapters

`@softzweig/suitcase-server/memory` ships `MemoryBucket` and `createMemoryRepositories()`, which
wires all three repositories over in-memory stores and exposes the transaction runner a server
needs. They are for development and tests only: one process, no durability, no sharing between
instances, and no production-shaped guarantees.

## Subpaths

| Import                       | Contents                                   |
| ---------------------------- | ------------------------------------------ |
| `@softzweig/suitcase-server` | Definition builder, server, ports, jobs    |
| `.../storage`                | Bucket port, access policy, storage errors |
| `.../repository`             | Repository contracts                       |
| `.../services`               | Service classes and the failure converter  |
| `.../memory`                 | In-memory bucket, stores and repositories  |
