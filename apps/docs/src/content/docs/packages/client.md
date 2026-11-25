---

title: client
description: The typed client and the upload workflow.
---

`@softzweig/suitcase-client` is transport-agnostic. It turns a definition into typed operations and
runs the multi-step upload flow on top of them.

## Create it

```ts title="suitcase/client.ts" {1,6,13}
import type { SuitcaseClient } from "./definition.js";
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { createHttpTransport } from "@softzweig/suitcase-http";

const operations = createSuitcaseOperations<SuitcaseClient>({
  transport: createHttpTransport({
    url: "/api/suitcase",
    configure: () => ({ headers: { "x-user": currentUser() } }),
  }),
});

export const client = createSuitcaseClient<SuitcaseClient>({
  operations,
  transfer: async (target, bytes, signal) => {
    const response = await fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body: bytes,
      signal,
    });

    if (!response.ok) throw new Error(`Upload refused (${response.status})`);
  },
});
```

`SuitcaseClient` is the alias exported from the definition module. Import it with `import type` so
the server package never enters the browser bundle. See
[Export the client type](/suitcase/guides/definitions/#export-the-client-type).

| Dependency   | Required | Meaning                                                       |
| ------------ | -------- | ------------------------------------------------------------- |
| `operations` | yes      | The typed operations, usually from `createSuitcaseOperations` |
| `transfer`   | yes      | Sends bytes to a presigned target                             |
| `digest`     | no       | Defaults to SHA-256 over the bytes                            |
| `processors` | no       | Rules applied before the file is claimed                      |

## The surface

```ts
client.operations; // every operation, raw
client.resources; // resolve, update, delete
client.upload.constraints({ kind });
client.upload.start({ kind, file, intent?, metadata?, signal? });
client.usage.total({ kinds, owner });
```

`upload.start` is the workflow, not one call. It reads constraints, processes the file, checks it,
claims it, reuses or transfers, and finalizes. It returns `{ resource, reused, upload }`.

## Transfer

The package does not assume `fetch` exists. You pass the function that moves bytes:

```ts
transfer: async (target, bytes, signal) => {
  const response = await fetch(target.url, {
    method: target.method,
    headers: target.headers,
    body: bytes,
    signal,
  });

  if (!response.ok) throw new Error(`Upload refused (${response.status})`);
};
```

## Errors

Refusals are `SuitcaseClientError` instances with a `ServiceErrorCode`, whether the server or the
client produced them. A network failure or a malformed response is refused as `unknown`.

## What it does not do

- It does not retry uploads.
- It does not cache resolves.
- It does not pick files, read cookies, or know about React.
- It does not read configuration from globals.

Those belong to the host, the transport, or the React bindings.
