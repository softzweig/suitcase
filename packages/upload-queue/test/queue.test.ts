import type { SuitcaseClient } from "@softzweig/suitcase-client";
import type {
  ClientDefinition,
  ClientResourceDefinition,
} from "@softzweig/suitcase-core/contracts";
import { describe, expect, test, vi } from "vitest";
import { createUploadQueue } from "../src/queue.js";

type TestDefinition = ClientDefinition<{
  avatar: ClientResourceDefinition<{
    owner: { userId: string };
    read: { userId: string };
    uploadIntent: { folderId: string };
  }>;
}>;

type Start = SuitcaseClient<TestDefinition>["upload"]["start"];
type Settled = Awaited<ReturnType<Start>>;

const SESSION_ID = crypto.randomUUID();
const RESOURCE_ID = crypto.randomUUID();
const ASSET_ID = crypto.randomUUID();
const WHEN = "2026-01-01T00:00:00.000Z";
const owner = { userId: "u_1" };

/** What `upload.start` settles on for an upload the backend answered by reusing its bytes. */
const settled: Settled = {
  resource: {
    assetId: ASSET_ID,
    createdAt: WHEN,
    fileName: "avatar.png",
    id: RESOURCE_ID,
    kind: "avatar",
    label: null,
    metadata: null,
    owner,
    updatedAt: null,
  },
  reused: true,
  upload: {
    createdAt: WHEN,
    expiresAt: WHEN,
    fileName: "avatar.png",
    hashAlgorithm: "sha256",
    hashHex: "0f",
    id: SESSION_ID,
    intent: { folderId: "f1" },
    kind: "avatar",
    metadata: null,
    mimeType: "image/png",
    owner,
    resourceId: RESOURCE_ID,
    size: 12,
    status: "completed",
    updatedAt: null,
  },
};

/** One upload, as the client's workflow takes it. */
const avatar = (name = "avatar.png"): Parameters<Start>[0] => ({
  file: { arrayBuffer: async () => new ArrayBuffer(12), name, size: 12, type: "image/png" },
  intent: { folderId: "f1" },
  kind: "avatar",
});

/** A `start` that holds every upload until the test releases it, so what runs is observable. */
const controlled = () => {
  const releases: (() => void)[] = [];
  const started: string[] = [];

  const start: Start = async ({ file }) => {
    started.push(file.name);
    await new Promise<void>((release) => releases.push(release));
    return settled;
  };

  return { release: () => releases.shift()?.(), start, started };
};

/** Lets the queue's own chains and the tasks it started run. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("running uploads", () => {
  test.for([
    { concurrency: 1, count: 3 },
    { concurrency: 2, count: 4 },
    { concurrency: 3, count: 5 },
  ])("runs at most $concurrency of $count uploads at once", async ({ concurrency, count }) => {
    const { release, start, started } = controlled();
    const queue = createUploadQueue<TestDefinition>(start, { concurrency });

    const uploads = Array.from({ length: count }, (_, index) =>
      queue.enqueue(avatar(`${index}.png`)),
    );
    await flush();

    expect(started).toHaveLength(concurrency);
    expect(queue.pending()).toBe(concurrency);
    expect(queue.size()).toBe(count - concurrency);

    // Releasing one upload frees exactly one slot, so exactly one more starts until all are in flight.
    while (started.length < count) {
      const running = started.length;
      release();
      await flush();

      expect(started).toHaveLength(running + 1);
      expect(queue.pending()).toBe(concurrency);
      expect(queue.size()).toBe(count - running - 1);
    }

    for (let slot = 0; slot < concurrency; slot++) {
      release();
    }

    await expect(Promise.all(uploads)).resolves.toEqual(
      Array.from({ length: count }, () => settled),
    );
  });

  test("settles with what the upload settled on", async () => {
    const queue = createUploadQueue<TestDefinition>(async () => settled);

    await expect(queue.enqueue(avatar())).resolves.toBe(settled);
  });

  test("keeps running after an upload fails", async () => {
    let attempt = 0;
    const queue = createUploadQueue<TestDefinition>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("the disk is full");
      return settled;
    });

    await expect(queue.enqueue(avatar())).rejects.toThrow("the disk is full");
    await expect(queue.enqueue(avatar())).resolves.toBe(settled);
  });

  test("keeps an upload cancelled while it waits from starting", async () => {
    const { release, start, started } = controlled();
    const queue = createUploadQueue<TestDefinition>(start, { concurrency: 1 });
    const controller = new AbortController();

    const running = queue.enqueue(avatar("first.png"));
    const waiting = queue.enqueue({ ...avatar("second.png"), signal: controller.signal });
    await flush();
    controller.abort();

    await expect(waiting).rejects.toThrow();
    expect(started).toEqual(["first.png"]);

    release();
    await expect(running).resolves.toBe(settled);
    expect(started).toEqual(["first.png"]);
  });
});

describe("pacing", () => {
  test("starts no more within a window than the window allows", async () => {
    vi.useFakeTimers();

    try {
      const started: string[] = [];
      const queue = createUploadQueue<TestDefinition>(
        async ({ file }) => {
          started.push(file.name);
          return settled;
        },
        { concurrency: 5, interval: 60_000, intervalCap: 2 },
      );

      void queue.enqueue(avatar("one.png"));
      void queue.enqueue(avatar("two.png"));
      void queue.enqueue(avatar("three.png"));
      await vi.advanceTimersByTimeAsync(0);

      expect(started).toEqual(["one.png", "two.png"]);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(started).toEqual(["one.png", "two.png", "three.png"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the queue's state", () => {
  test("holds every upload back while paused", async () => {
    const { release, start, started } = controlled();
    const queue = createUploadQueue<TestDefinition>(start);

    queue.pause();
    expect(queue.isPaused()).toBe(true);

    const upload = queue.enqueue(avatar());
    await flush();
    expect(started).toEqual([]);
    expect(queue.size()).toBe(1);

    queue.start();
    expect(queue.isPaused()).toBe(false);
    await flush();
    expect(started).toEqual(["avatar.png"]);

    release();
    await expect(upload).resolves.toBe(settled);
  });

  test("settles when idle, once nothing is waiting or running", async () => {
    const { release, start } = controlled();
    const queue = createUploadQueue<TestDefinition>(start);

    void queue.enqueue(avatar());
    await flush();
    expect(queue.size()).toBe(0);

    const idle = queue.onIdle();
    release();

    await expect(idle).resolves.toBeUndefined();
  });
});
