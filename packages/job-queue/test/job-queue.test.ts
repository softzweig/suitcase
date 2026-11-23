import { describe, expect, test, vi } from "vitest";
import {
  createMemoryJobQueue,
  createNoopJobQueue,
  type MemoryJobQueueOptions,
} from "../src/job-queue.js";

type TestJobs = {
  "avatars.purge": { readonly avatarId: string };
  "avatars.thumbnail": { readonly avatarId: string };
};

type Purge = (payload: TestJobs["avatars.purge"]) => void | Promise<void>;

const avatar = { avatarId: "a_1" };

/** A queue whose purge handler is the test's, and whose other job does nothing. */
const givenQueue = (purge: Purge, options: MemoryJobQueueOptions = {}) =>
  createMemoryJobQueue<TestJobs>(
    { "avatars.purge": purge, "avatars.thumbnail": () => {} },
    options,
  );

/** Lets the queue's own chains and the tasks it started run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("running jobs", () => {
  test("runs a job with the payload it was given", async () => {
    const payloads: unknown[] = [];
    const queue = givenQueue((payload) => void payloads.push(payload));

    await queue.enqueue("avatars.purge", avatar);
    await queue.onIdle();

    expect(payloads).toEqual([avatar]);
  });

  test("takes the job before it runs it", async () => {
    let calls = 0;
    const queue = givenQueue(() => {
      calls += 1;
    });
    queue.pause();

    await queue.enqueue("avatars.purge", avatar);

    expect(queue.isPaused()).toBe(true);
    expect(queue.size()).toBe(1);
    expect(calls).toBe(0);

    queue.start();
    await queue.onIdle();

    expect(calls).toBe(1);
  });

  test("runs no more than its concurrency at once", async () => {
    const started: string[] = [];
    const releases: (() => void)[] = [];
    const queue = createMemoryJobQueue<TestJobs>(
      {
        "avatars.purge": async ({ avatarId }) => {
          started.push(avatarId);
          await new Promise<void>((release) => releases.push(release));
        },
        "avatars.thumbnail": async () => {},
      },
      { concurrency: 2 },
    );

    for (const avatarId of ["a", "b", "c", "d"]) {
      await queue.enqueue("avatars.purge", { avatarId });
    }

    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(queue.pending()).toBe(2);
    expect(queue.size()).toBe(2);

    for (const release of releases.splice(0)) release();
    await flush();

    expect(started).toEqual(["a", "b", "c", "d"]);

    for (const release of releases.splice(0)) release();
    await queue.onIdle();
  });
});

describe("failing jobs", () => {
  test("retries a job that failed", async () => {
    let calls = 0;
    const queue = givenQueue(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("the bucket is down");
      },
      { attempts: 2, retryDelayMs: 0 },
    );

    await queue.enqueue("avatars.purge", avatar);
    await queue.onIdle();

    expect(calls).toBe(2);
  });

  test("lets a job ask for more attempts than the queue's", async () => {
    let calls = 0;
    const queue = givenQueue(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("the bucket is down");
      },
      { attempts: 1, retryDelayMs: 0 },
    );

    await queue.enqueue("avatars.purge", avatar, { attempts: 2 });
    await queue.onIdle();

    expect(calls).toBe(2);
  });

  test("reports a job that ran out of attempts", async () => {
    const error = new Error("the bucket is down");
    const onError = vi.fn();
    const queue = givenQueue(
      async () => {
        throw error;
      },
      { attempts: 2, retryDelayMs: 0, onError },
    );

    await queue.enqueue("avatars.purge", avatar);
    await queue.onIdle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, {
      name: "avatars.purge",
      payload: avatar,
      attempts: 2,
    });
  });

  test("keeps running after a job it gave up on", async () => {
    let calls = 0;
    const queue = givenQueue(
      async () => {
        calls += 1;
        throw new Error(`attempt ${calls}`);
      },
      { attempts: 1, retryDelayMs: 0 },
    );

    await queue.enqueue("avatars.purge", avatar);
    await queue.enqueue("avatars.purge", avatar);
    await queue.onIdle();

    expect(calls).toBe(2);
  });
});

describe("the noop queue", () => {
  test("takes jobs and drops them", async () => {
    const queue = createNoopJobQueue<TestJobs>();

    await expect(queue.enqueue("avatars.purge", avatar)).resolves.toBeUndefined();
    expect(queue.size()).toBe(0);
    expect(queue.pending()).toBe(0);
    await expect(queue.onIdle()).resolves.toBeUndefined();
  });
});
