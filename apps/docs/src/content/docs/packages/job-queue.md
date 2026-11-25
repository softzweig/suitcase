---

title: job-queue
description: Named work that runs outside the call that scheduled it.
---

`@softzweig/suitcase-job-queue` defines the job queue port the server depends on and ships one
in-memory driver. `enqueue` settles on acceptance, and the work is retried without the caller.

This is not upload pacing. An upload call is awaited for its result and can be cancelled by the
caller. That is `@softzweig/suitcase-upload-queue`.

## Use it

```ts
import { createMemoryJobQueue } from "@softzweig/suitcase-job-queue";

const jobs = createMemoryJobQueue<SuitcaseJobs>(handlers, {
  concurrency: 2,
  onError: (error, job) => logger.error({ error, job }, "job failed"),
});

await jobs.enqueue("assets.purge", { assetId });
```

The server supplies the handlers. The queue only says where they run.

## Options

| Option         | Default | Meaning                                        |
| -------------- | ------- | ---------------------------------------------- |
| `concurrency`  | `4`     | Jobs in flight at once                         |
| `attempts`     | `3`     | Attempts before a job is given up              |
| `retryDelayMs` | `1000`  | First retry delay, doubling after each attempt |
| `onError`      | none    | Where a job that ran out of attempts goes      |

A job can ask for more attempts with `enqueue(name, payload, { attempts })`.

## State

`size()`, `pending()`, `isPaused()`, `pause()`, `start()`, and `onIdle()` behave as they do in the
upload queue.

## What it is not

- Not durable: nothing survives the process.
- Not a scheduler: no cron, no delay beyond retry backoff.
- Not a workflow engine: one function, one payload.

A durable queue is a different driver behind the same port. The handlers do not change.
