# @softzweig/suitcase-http

The HTTP binding for Suitcase: the transport a client calls, and the handler a server mounts.

Both halves speak the Fetch API — `fetch` on the client, `Request`/`Response` on the server — so the
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

## The server

```ts
import { createHttpHandler } from "@softzweig/suitcase-http/server";

const handler = createHttpHandler({
  bind: (request) => server.forExecution({ userId: authorize(request) }),
});

// Node, Bun, Deno, a worker, or any framework that hands you a `Request`.
export default { fetch: handler };
```

`bind` runs once per request, so the execution context — the auth it read, the definition it
resolved — is closed over and never carried through the handler.

## The wire

`POST {mount}/{operation}` with the operation's input as the JSON body, answered with the
`ServiceResult` the services already produce.

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

The client turns a refusal into a `SuitcaseClientError` carrying the server's own `ServiceErrorCode`,
so one set of codes covers both sides. A response that is not a `ServiceResult` at all — a gateway
page, an empty body — is refused as `unknown` with the status in `details`.

## Two things worth knowing

- **No bytes cross this transport.** An upload's bytes go straight to the signed URL the backend
  hands out, so every call here is a small JSON document: no multipart, no streaming.
- **`SuitcaseTransport.call` takes no signal**, so aborting cancels an upload between steps rather
  than interrupting a request in flight.
