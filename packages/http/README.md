# @softzweig/suitcase-http

The HTTP binding for Suitcase: the transport a client calls, and the handler a server mounts.

Both halves speak the Fetch API (`fetch` on the client, `Request`/`Response` on the server) so the
package runs unchanged in browsers, workers, Node, Bun and Deno. There is nothing to configure and no
runtime to name.

## The client

```ts
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createHttpTransport } from "@softzweig/suitcase-http";

const client = createSuitcaseClient<MyDefinition>({
  operations: createSuitcaseOperations({
    transport: createHttpTransport({ url: "/api/suitcase" }),
  }),
  digest,
  transfer,
});
```

`headers` and `fetch` are both optional: pass `fetch` when you need to intercept calls, and `headers`
for whatever your backend authorizes with.

Anything that changes between calls (a token from a store, the user the page is acting as) goes
through `configure`, which is asked before every call and wins over the two fixed options:

```ts
const transport = createHttpTransport({
  url: "/api/suitcase",
  configure: () => ({ headers: { "x-user": currentUser() } }),
});
```

## The server

```ts
import { createHttpHandler } from "@softzweig/suitcase-http/server";

const handler = createHttpHandler({
  bind: (request) => server.forExecution({ userId: authorize(request) }),
});

// Node, Bun, Deno, a worker, or any framework that hands you a `Request`.
export default { fetch: handler };
```

`bind` runs once per request, so the execution context (the auth it read, the definition it
resolved) is closed over and never carried through the handler.

## The wire

`POST {mount}/{operation}` with the operation's input as the JSON body, answered with the
`SpindleResult` the services already produce.

| outcome               | status | body                                            |
| --------------------- | ------ | ----------------------------------------------- |
| success               | 200    | `{ ok: true, data }`                            |
| `not_found`           | 404    | `{ ok: false, code, message, details? }`        |
| `invalid_input`       | 400    | as above, with `details.issues` from the schema |
| `forbidden`           | 403    | as above                                        |
| `conflict`            | 409    | as above                                        |
| `precondition_failed` | 412    | as above                                        |
| `unavailable`         | 503    | as above                                        |
| `unknown`             | 500    | as above, message kept opaque                   |

The client turns a refusal into a `SuitcaseClientError` carrying the server's own `SpindleErrorCode`,
so one set of codes covers both sides. A response that is not a `SpindleResult` at all (a gateway
page, an empty body) is refused as `unknown` with the status in `details`.

## Two things worth knowing

- **No bytes cross this transport.** An upload's bytes go straight to the signed URL the backend
  hands out, so every call here is a small JSON document: no multipart, no streaming.
- **`SuitcaseTransport.call` takes no signal**, so aborting cancels an upload between steps rather
  than interrupting a request in flight.

## A whole app, end to end

`test/flow.integration.test.ts` is the example this package is tested by: a definition with two
kinds over two memory buckets, the real services, this handler, and a client whose transport is the
handler. It uploads a file, resolves it, reuses bytes it already has, reads tenant-scoped invoices,
renames and deletes one, surfaces a 404 as a `SuitcaseClientError`, and runs a batch through
`@softzweig/suitcase-upload-queue`. Only the storage adapters and the browser's digest/transfer hooks
are stand-ins.

```sh
pnpm vitest run --project integration packages/http
```
