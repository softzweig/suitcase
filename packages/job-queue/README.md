# @softzweig/suitcase-job-queue

A small job queue for Suitcase: named work that runs outside the call that scheduled it.

The port is what the server depends on, so a deployment can run the jobs somewhere else. The
in-memory driver runs them in this process and is the one to start with.

**Note: this is a very simplistic implementation of a job queue, using the `p-queue` dependency.**
It is not durable: a job queued when the process ends is gone.

## Usage

```ts
import { createMemoryJobQueue } from "@softzweig/suitcase-job-queue";

const jobs = createMemoryJobQueue<SuitcaseJobs>(createJobHandlers(server), {
  concurrency: 2,
  onError: (error, job) => logger.error({ error, job }, "job failed"),
});

await jobs.enqueue("assets.purge", { assetId });
```

`enqueue` settles once the queue has taken the job, not once the job ran: the work outlives the
caller, and a failure is the queue's to report. `onIdle()` is how a caller — usually a test — waits
for everything it scheduled.

## Options

| Option         | Default | Meaning                                                           |
| -------------- | ------- | ----------------------------------------------------------------- |
| `concurrency`  | `4`     | Jobs in flight at once.                                           |
| `attempts`     | `3`     | Attempts a job gets before it is given up on.                     |
| `retryDelayMs` | `1000`  | How long the first retry waits; each further attempt doubles it.  |
| `onError`      | –       | Where a job that ran out of attempts goes. Absent, it is dropped. |

A job can ask for more attempts through `enqueue(name, payload, { attempts })`.

## State

`size()` is what is waiting (or waiting to retry), `pending()` is what is running, `isPaused()` is
whether new jobs are held. `pause()` stops starting jobs while the ones already running finish,
`start()` resumes, and `onIdle()` settles once nothing is waiting and nothing is running.

## What it is not

- **Not durable.** Nothing survives the process; a queue that has to is a different driver behind
  the same `JobQueue` port.
- **Not a scheduler.** There is no cron and no delay beyond a retry's backoff.
- **Not a workflow engine.** A job is one function with one payload.
