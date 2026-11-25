---

title: http
description: Fetch transport and request handler.
---

`@softzweig/suitcase-http` is the HTTP binding. Both halves speak the Fetch API, so the package runs
in browsers, workers, Node, Bun, and Deno without configuration.

## Client transport

```ts
import { createHttpTransport } from "@softzweig/suitcase-http";

const transport = createHttpTransport({
  url: "/api/suitcase",
  headers: { authorization: `Bearer ${token}` },
});
```

`headers` and `fetch` are optional. Anything that changes between calls belongs in `configure`,
which is asked before every call and wins over the fixed options:

```ts
const transport = createHttpTransport({
  url: "/api/suitcase",
  configure: () => ({ headers: { "x-user": currentUser() } }),
});
```

## Server handler

```ts
import { createHttpHandler } from "@softzweig/suitcase-http/server";

const handler = createHttpHandler(
  (request) => server.forExecution({ userId: authorize(request) }).operations,
);

export default { fetch: handler };
```

`bind` runs once per request. Read the session there and hand `forExecution` the context it returns.

In a Next.js App Router route, export the handler as `POST`:

```ts
export const POST = handler;
```

## The wire

`POST {mount}/{operation}` with the operation input as JSON, answered with a `ServiceResult`.

| Outcome               | Status | Body                                     |
| --------------------- | ------ | ---------------------------------------- |
| success               | 200    | `{ ok: true, data }`                     |
| `not_found`           | 404    | `{ ok: false, code, message, details? }` |
| `invalid_input`       | 400    | As above, with `details.issues`          |
| `forbidden`           | 403    | As above                                 |
| `conflict`            | 409    | As above                                 |
| `precondition_failed` | 412    | As above                                 |
| `unavailable`         | 503    | As above                                 |
| `unknown`             | 500    | As above, message kept opaque            |

## Two properties

- **No bytes cross this transport.** Uploads go straight to the presigned target, so every call is
  a small JSON document.
- **`call` takes no signal.** Aborting cancels an upload between steps rather than interrupting a
  request in flight.

A response that is not a valid `ServiceResult`, such as a gateway page or an empty body, is refused
as `unknown` with the status in `details`.
