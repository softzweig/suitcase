import PQueue from "p-queue";

/** Jobs in flight when nothing says otherwise. */
const DEFAULT_CONCURRENCY = 4;

/** Attempts a job gets before the queue gives up on it. */
const DEFAULT_ATTEMPTS = 3;

/** How long the first retry waits; each further one doubles it. */
const DEFAULT_RETRY_DELAY_MS = 1_000;

/** The names a job can have: the keys of `TJobs` a string can name. */
export type JobName<TJobs extends Record<string, unknown>> = Extract<keyof TJobs, string>;

/** What a job does with its payload. */
export type JobHandler<TJobs extends Record<string, unknown>, TName extends JobName<TJobs>> = (
  payload: TJobs[TName],
) => void | Promise<void>;

/** What each job does, keyed by its name. */
export type JobHandlers<TJobs extends Record<string, unknown>> = {
  readonly [TName in JobName<TJobs>]: JobHandler<TJobs, TName>;
};

/** A job the queue gave up on, after its last attempt failed. */
export type FailedJob = Readonly<{
  name: string;
  payload: unknown;
  attempts: number;
}>;

export type JobEnqueueOptions = Readonly<{
  /** Attempts this job gets before the queue gives up on it. Defaults to the queue's. */
  attempts?: number;
}>;

/**
 * Named work that runs outside the call that scheduled it, keyed by job name.
 *
 * `TJobs` maps a name to the payload that name carries, so `enqueue` and the handlers are typed
 * from one declaration. `enqueue` settles once the queue has taken the job, not once the job ran:
 * the work outlives the caller, and a failure is the queue's to report through its error sink.
 */
export interface JobQueue<TJobs extends Record<string, unknown> = Record<string, unknown>> {
  /** Takes one job. Resolves once it is accepted, whatever it does afterwards. */
  enqueue<TName extends JobName<TJobs>>(
    name: TName,
    payload: TJobs[TName],
    options?: JobEnqueueOptions,
  ): Promise<void>;

  /** Jobs waiting for a slot or a retry. */
  size(): number;

  /** Jobs running now. */
  pending(): number;

  /** Whether new jobs are held back. */
  isPaused(): boolean;

  /** Stops starting jobs; the ones already running finish. */
  pause(): void;

  /** Resumes starting the queued jobs. */
  start(): void;

  /** Settles once nothing is waiting and nothing is running. */
  onIdle(): Promise<void>;
}

/**
 * A queue with its jobs erased, for code that only has to enqueue: a context can hold one without
 * knowing what this deployment schedules.
 */
export type AnyJobQueue = JobQueue<Record<string, unknown>>;

export interface MemoryJobQueueOptions {
  /** Jobs in flight at once. @default 4 */
  readonly concurrency?: number;
  /** Attempts a job gets before it is given up on. @default 3 */
  readonly attempts?: number;
  /** How long the first retry waits, in ms (exponential backoff) @default 1000 */
  readonly retryDelayMs?: number;
  /** Where a job that ran out of attempts goes. Absent, it is only dropped. */
  readonly onError?: (error: unknown, job: FailedJob) => void;
}

/**
 * A queue that runs the jobs in this process: the driver to start with, and the one tests reach
 * for. Concurrency, attempts and backoff are its own; durability is not, so a job that was queued
 * when the process ended is gone.
 *
 * A poison job does not take the queue down: the failure is reported to `onError` and the queue
 * moves on.
 *
 * @example
 * ```ts
 * const jobs = createMemoryJobQueue<SuitcaseJobs>(createJobHandlers(server), {
 *   concurrency: 2,
 *   onError: (error, job) => logger.error({ error, job }, "job failed"),
 * });
 * ```
 *
 * @human
 */
export function createMemoryJobQueue<TJobs extends Record<string, unknown>>(
  handlers: JobHandlers<TJobs>,
  {
    concurrency = DEFAULT_CONCURRENCY,
    attempts: defaultAttempts = DEFAULT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onError,
  }: MemoryJobQueueOptions = {},
): JobQueue<TJobs> {
  const queue = new PQueue({ concurrency });

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /**
   * Hands a job that is out of attempts to the sink. Nothing is left to report a failing sink to,
   * so a throw from it is dropped rather than taking the job's run down with it.
   */
  function report(error: unknown, job: FailedJob) {
    try {
      onError?.(error, job);
    } catch {}
  }

  /** Runs one job at least once, retrying it with a doubling delay while attempts are left. */
  async function run<TName extends JobName<TJobs>>(
    name: TName,
    payload: TJobs[TName],
    limit: number,
  ) {
    for (let attempt = 1; ; attempt++) {
      try {
        await handlers[name](payload);
        break;
      } catch (error) {
        if (attempt >= limit) {
          report(error, { name, payload, attempts: attempt });
          break;
        }

        // Inside the run, so the retry counts as pending and `onIdle` waits for it.
        await sleep(retryDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  return {
    enqueue: async (name, payload, options) => {
      // Accepted, not run: the job settles on its own and never rejects.
      void queue.add(() => run(name, payload, options?.attempts ?? defaultAttempts));
    },
    size: () => queue.size,
    pending: () => queue.pending,
    isPaused: () => queue.isPaused,
    pause: () => queue.pause(),
    start: () => queue.start(),
    onIdle: () => queue.onIdle(),
  };
}

/**
 * A queue that takes every job and drops it: what a server runs when no queue is wired, so
 * scheduling never fails but nothing is run in the background either.
 *
 * @deprecated Only use for testing or when no real job queue is needed
 */
export const createNoopJobQueue = <
  TJobs extends Record<string, unknown> = Record<string, unknown>,
>(): JobQueue<TJobs> => ({
  enqueue: () => Promise.resolve(),
  size: () => 0,
  pending: () => 0,
  isPaused: () => false,
  pause: () => {},
  start: () => {},
  onIdle: () => Promise.resolve(),
});
