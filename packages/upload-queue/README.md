# @softzweig/suitcase-upload-queue

The upload queue for Suitcase: a ceiling on what runs at once, and optionally a rate window, on top
of the client's `upload.start`.

Pacing for one client call, and it returns that call's result. Not a job system: nothing here
outlives the caller, nothing is retried, and background work belongs in
`@softzweig/suitcase-job-queue`.

It runs wherever the client does (browser, worker or Node) since all it needs is `AbortSignal` and
the platform's own timers.

**Note: this is a very simplistic implementation of an upload queue, using the `p-queue` dependency.**

## Usage

```ts
import { createUploadQueue } from "@softzweig/suitcase-upload-queue";

const uploads = createUploadQueue<MyDefinition>(client.upload.start, {
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

`enqueue` is the client's own `upload.start`, so `kind`, the intent and the result stay typed by the
definition. It settles when that upload does: the result, or the refusal it threw.

## Options

| Option        | Default | Meaning                                                  |
| ------------- | ------- | -------------------------------------------------------- |
| `concurrency` | `4`     | Uploads in flight at once.                               |
| `intervalCap` | –       | Starts allowed within `interval`, e.g. `2` per minute.   |
| `interval`    | –       | The window `intervalCap` counts within, in milliseconds. |

`intervalCap` needs `interval` to mean anything; the two together are a fixed window, so a burst can
land on a window boundary. Set them lower than the backend's real limit if it is strict.

## State

`size()` is what is waiting, `pending()` is what is running, `isPaused()` is whether new uploads are
held. `pause()` stops starting uploads while the ones already running finish, `start()` resumes, and
`onIdle()` settles once nothing is waiting and nothing is running.

## Cancelling

Pass an `AbortSignal` on the upload. One cancelled while it waits is dropped instead of started, so
it never holds a slot; one cancelled while running stops inside `upload.start`, which checks the
signal between its steps.

## What it is not

- **Not batching.** Every upload is its own session with its own bytes, so there is nothing to
  merge. Resolving many resources in one call is the client's job; this is only about pacing writes.
- **Not a retry policy.** A failed upload rejects its `enqueue` and the queue moves on.
- **Not a cache.** Nothing is remembered between uploads.
