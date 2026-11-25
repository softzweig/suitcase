---

title: Your first upload
description: Wire a definition, a server, a client, and one upload.
---

This walkthrough uses an in-memory bucket and SQLite, so it runs without infrastructure. Swap the
bucket and repository adapters for S3 and your database when you are ready.

## 1. Define the kind

```ts {23,28}
// suitcase/definition.ts
import { z } from "zod";
import { BucketAccessPolicy, Suitcase } from "@softzweig/suitcase-server";
import { createMemoryBucketConfig } from "@softzweig/suitcase-server/memory";
import type { InferSuitcaseClient } from "@softzweig/suitcase-server";

export const definition = Suitcase.withBuckets({
  // Every definition has an upload bucket. Sessions land here before they are promoted.
  upload: createMemoryBucketConfig("uploads"),
  avatars: createMemoryBucketConfig("avatars", { access: BucketAccessPolicy.PUBLIC }),
})
  .withContext<{ userId: string }>()
  .withResources(({ owner, read, resource }) => {
    const user = owner({
      schema: z.object({ userId: z.string() }),
      authorize: ({ execution, owner }) => owner.userId === execution.userId,
    });

    return {
      avatar: resource("avatar", {
        bucket: "avatars",
        owner: user,
        read: read({ expose: () => true }),
        upload: user.upload({
          mimeTypes: ["image/png", "image/jpeg", "image/webp"],
          maxSize: "5 MB",
          // The owner is derived from the execution, never sent by the client.
          ownedBy: ({ execution }) => ({ userId: execution.userId }),
        }),
      }),
    };
  });

/** The same definition, typed for the browser. */
export type SuitcaseClient = InferSuitcaseClient<typeof definition>;
```

The highlighted lines are the two decisions this flow depends on: `read` decides who may receive
links, and `ownedBy` decides who owns the new resource. The client never sends the owner.

## 2. Create the server

```ts
// suitcase/server.ts
import { createClient } from "@libsql/client";
import { createSqliteServerAdapters } from "@softzweig/suitcase-drizzle/sqlite-core";
import { createHttpHandler } from "@softzweig/suitcase-http/server";
import { createSuitcaseServer } from "@softzweig/suitcase-server";
import { drizzle } from "drizzle-orm/libsql";
import { definition } from "./definition.js";

const db = drizzle(createClient({ url: "file:./suitcase.db" }));

export const server = createSuitcaseServer(definition, createSqliteServerAdapters(db));

/**
 * `bind` runs once per request. Read your session here.
 * A stand-in header keeps this example short; a real app validates a token.
 */
export const handleOperation = createHttpHandler(
  (request) => server.forExecution({ userId: request.headers.get("x-user") ?? "u_1" }).operations,
);
```

Mount `handleOperation` where your runtime expects a `Request` handler. In a Next.js App Router
route, `export const POST = handleOperation`.

The SQLite tables come from the migrations in `packages/drizzle/migrations/sqlite`. See
[Persistence](/suitcase/guides/persistence/) for the Drizzle setup.

## 3. Create the client

```ts {5,7}
// suitcase/client.ts
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { createHttpTransport } from "@softzweig/suitcase-http";
import type { SuitcaseClient } from "./definition.js";

export const client = createSuitcaseClient<SuitcaseClient>({
  operations: createSuitcaseOperations<SuitcaseClient>({
    transport: createHttpTransport({
      url: "/api/suitcase",
      // Ask before every call for anything that changes, such as the current session.
      configure: () => ({ headers: { "x-user": currentUser() } }),
    }),
  }),
  transfer: async (target, bytes) => {
    const response = await fetch(target.url, {
      body: bytes,
      headers: target.headers,
      method: target.method,
    });

    if (!response.ok) {
      throw new Error(`The upload was refused (${response.status}).`);
    }
  },
});
```

Build the client once. A client created per render restarts every batcher and queue behind it.

The `import type` for `SuitcaseClient` is deliberate. It erases at build time, so the browser never
imports the server definition. See
[Export the client type](/suitcase/guides/definitions/#export-the-client-type) for the dev
dependency rule that keeps it that way.

## 4. Upload

One call runs the whole flow: read the kind's limits, apply any processors, check the file, claim
it, let the backend reuse or presign, send the bytes, and finalize.

```ts title="client.upload.start"
const { resource, reused } = await client.upload.start({
  kind: "avatar",
  file,
});

console.log(resource.id, reused ? "reused existing bytes" : "stored new bytes");
```

The bytes are sent to the presigned target, not to `/api/suitcase`. The operation endpoints only see
JSON.

## 5. Render it with React

```tsx title="App.tsx"
import { SuitcaseProvider, useUploadResource } from "@softzweig/suitcase-react";
import { client } from "./suitcase/client.js";
import type { SuitcaseClient } from "./suitcase/definition.js";

function Picker() {
  const { phase, error, upload } = useUploadResource<SuitcaseClient>();

  return (
    <>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload({ kind: "avatar", file });
        }}
      />
      {phase === "uploading" && <p>Uploading</p>}
      {error && <p>{error.message}</p>}
    </>
  );
}

export function App() {
  return (
    <SuitcaseProvider client={client}>
      <Picker />
    </SuitcaseProvider>
  );
}
```

`useUploadResource` keeps failures as state instead of throwing, because a screen usually renders
the reason next to the picker.

Next: [The upload flow](/suitcase/guides/uploads/) explains each step, deduplication, and cancellation.
