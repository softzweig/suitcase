---

title: upload-queue
description: A concurrency ceiling and rate window over client uploads.
---

`@softzweig/suitcase-upload-queue` paces calls to `client.upload.start`. It is not a job system:
nothing outlives the caller, nothing is retried, and background work belongs in
`@softzweig/suitcase-job-queue`.

## Create it

```ts {2-3}
import { createUploadQueue } from "@softzweig/suitcase-upload-queue";
import type { SuitcaseClient } from "./definition.js";
import { client } from "./suitcase/client.js";

const uploads = createUploadQueue<SuitcaseClient>(client.upload.start, {
  concurrency: 2,
  intervalCap: 10,
  interval: 60_000,
});

const { resource, reused } = await uploads.enqueue({
  kind: "avatar",
  file,
  intent: { folderId },
});
```

`enqueue` is the client's own `upload.start`, so kinds, intents, and results stay typed by the
definition. It settles when that upload does.

## Options

| Option        | Default | Meaning                                                 |
| ------------- | ------- | ------------------------------------------------------- |
| `concurrency` | `4`     | Uploads in flight at once                               |
| `intervalCap` | none    | Starts allowed within `interval`                        |
| `interval`    | none    | The window `intervalCap` counts within, in milliseconds |

`intervalCap` needs `interval` to mean anything. The pair is a fixed window, so a burst can land on
a boundary. Set them lower than a strict backend limit.

## State

- `size()`: waiting uploads;
- `pending()`: running uploads;
- `isPaused()`: whether new uploads are held;
- `pause()` and `start()`;
- `onIdle()`: settles when nothing is waiting and nothing is running.

## Cancellation

Pass an `AbortSignal` on the upload. One cancelled while waiting is dropped instead of started. One
cancelled while running stops inside `upload.start`, which checks the signal between its steps.

## What it is not

- Not batching: every upload has its own session and bytes.
- Not a retry policy: a failure rejects `enqueue` and the queue moves on.
- Not a cache: nothing is remembered between uploads.
