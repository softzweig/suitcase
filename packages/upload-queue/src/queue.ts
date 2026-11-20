import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type { ClientDefinition } from "@softzweig/suitcase-core/contracts";
import PQueue from "p-queue";

/** Uploads in flight when nothing says otherwise. */
const DEFAULT_CONCURRENCY = 4;

/** How many uploads may run at once, and how many may start per window. */
export interface UploadQueueOptions {
  /** Uploads in flight at once. Defaults to {@link DEFAULT_CONCURRENCY}. */
  readonly concurrency?: number;
  /**
   * Starts allowed within `interval`, e.g. `{ intervalCap: 2, interval: 60_000 }` for two a minute.
   * Ignored unless both are given.
   */
  readonly intervalCap?: number;
  /** The window `intervalCap` counts within, in milliseconds. */
  readonly interval?: number;
}

/**
 * A client's uploads, paced: the same `upload.start` call, with a ceiling on what runs at once and
 * optionally a rate window.
 *
 * Pacing, not batching. Every upload is its own session with its own bytes, so there is nothing to
 * merge; what a queue adds is that a burst of ten uploads does not become ten parallel transfers.
 *
 * An upload cancelled while it waits is dropped rather than started, so it never holds a slot. One
 * cancelled while running stops inside `start`, which checks its signal between steps.
 */
export interface UploadQueue<TDefinition extends ClientDefinition = ClientDefinition> {
  /** Queues one upload and settles when that upload does, with its result or its refusal. */
  readonly enqueue: SuitcaseClient<TDefinition>["upload"]["start"];

  /** Uploads waiting for a slot. */
  size(): number;

  /** Uploads running now. */
  pending(): number;

  /** Whether new uploads are held back. */
  isPaused(): boolean;

  /** Stops starting uploads; the ones already running finish. */
  pause(): void;

  /** Resumes starting the queued uploads. */
  start(): void;

  /** Settles once nothing is waiting and nothing is running. */
  onIdle(): Promise<void>;
}

/**
 * Wraps a client's upload workflow in a queue.
 *
 * @example
 * ```ts
 * const uploads = createUploadQueue<MyDefinition>(client.upload.start, {
 *   concurrency: 2,
 *   intervalCap: 10,
 *   interval: 60_000,
 * });
 *
 * await uploads.enqueue({ kind: "avatar", file, intent: { folderId } });
 * ```
 */
export const createUploadQueue = <TDefinition extends ClientDefinition = ClientDefinition>(
  start: SuitcaseClient<TDefinition>["upload"]["start"],
  { concurrency = DEFAULT_CONCURRENCY, intervalCap, interval }: UploadQueueOptions = {},
): UploadQueue<TDefinition> => {
  const queue = new PQueue({ concurrency, interval, intervalCap });

  return {
    enqueue: (input) => queue.add(() => start(input), { signal: input.signal }),
    size: () => queue.size,
    pending: () => queue.pending,
    isPaused: () => queue.isPaused,
    pause: () => queue.pause(),
    start: () => queue.start(),
    onIdle: () => queue.onIdle(),
  };
};
