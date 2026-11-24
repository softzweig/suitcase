import type { ProcessorContext, ProcessorRule } from "@softzweig/suitcase-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createImageProcessor,
  type ImageProcessorOptions,
  type ImageRequest,
  type ImageRunner,
} from "../src/index.js";
import type { WorkerRequest, WorkerResponse } from "../src/worker.js";

type UploadFile = ProcessorContext["file"];

const constraints = { hasIntent: false, maxSize: null, mimeTypes: null };
const wasmUrl = "https://cdn.test/magick.wasm";

/** A picked file: 12 bytes of png unless a test says otherwise. */
const picked = (overrides: Partial<UploadFile> = {}): UploadFile => ({
  name: "cat.png",
  size: 12,
  type: "image/png",
  arrayBuffer: async () => new Uint8Array(12).buffer,
  ...overrides,
});

const contextFor = (file: UploadFile): ProcessorContext => ({ constraints, file, kind: "avatar" });

const upload = (processor: ProcessorRule, file = picked(), signal?: AbortSignal) =>
  processor.process({ context: contextFor(file), signal, value: file });

/** A runner that records what it was asked, and answers with `size` bytes of webp. */
const recordingRunner = (size = 6) => {
  const requests: ImageRequest[] = [];

  const run: ImageRunner = async (request) => {
    requests.push(request);
    return { bytes: new Uint8Array(size), type: "image/webp" };
  };

  return { requests, run };
};

describe("createImageProcessor", () => {
  test("sends the file's bytes with the defaults that apply", async () => {
    const { requests, run } = recordingRunner(6);
    const processor = createImageProcessor({}, { run });

    const result = await upload(processor);

    expect(processor.name).toBe("image");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      background: "white",
      format: "webp",
      maxDimension: undefined,
      quality: 80,
    });
    expect(requests[0]?.bytes).toEqual(new Uint8Array(12));
    expect(result).toMatchObject({ name: "cat.webp", size: 6, type: "image/webp" });
    await expect(result.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
  });

  test("lets each option replace its default", async () => {
    const { requests, run } = recordingRunner();
    const options: ImageProcessorOptions = {
      background: "#101010",
      format: "gif",
      maxDimension: 800,
      quality: 60,
    };

    await upload(createImageProcessor(options, { run }));

    expect(requests[0]).toMatchObject({
      background: "#101010",
      format: "gif",
      maxDimension: 800,
      quality: 60,
    });
  });

  test.for([
    { format: "gif", name: "cat.gif" },
    { format: "jpeg", name: "cat.jpg" },
    { format: "png", name: "cat.png" },
    { format: "webp", name: "cat.webp" },
  ] as const)("names the file for the $format it was written as", async ({ format, name }) => {
    const { requests, run } = recordingRunner(4);

    const result = await upload(createImageProcessor({ format }, { run }));

    expect(result.name).toBe(name);
    expect(requests[0]).toMatchObject({ format });
  });

  test.for([
    { given: "cat", expected: "cat.webp" },
    { given: "my.photo.jpeg", expected: "my.photo.webp" },
    { given: "CAT.PNG", expected: "CAT.webp" },
  ])("replaces the extension of $given", async ({ expected, given }) => {
    const processor = createImageProcessor({}, { run: recordingRunner().run });

    const result = await upload(processor, picked({ name: given }));

    expect(result.name).toBe(expected);
  });

  test.for([
    { expected: "photo.jpg", given: "photo.jpg" },
    { expected: "photo.jpeg", given: "photo.jpeg" },
    { expected: "PHOTO.JPEG", given: "PHOTO.JPEG" },
  ])("keeps $given when it already says jpeg", async ({ expected, given }) => {
    const processor = createImageProcessor({ format: "jpeg" }, { run: recordingRunner().run });

    const result = await upload(processor, picked({ name: given }));

    expect(result.name).toBe(expected);
  });

  test.for([
    { asks: true, type: "image/png" },
    { asks: true, type: "image/gif" },
    { asks: true, type: "image/svg+xml" },
    { asks: false, type: "application/pdf" },
    { asks: false, type: "video/mp4" },
  ])("asks for $type: $asks", ({ asks, type }) => {
    const processor = createImageProcessor({}, { run: recordingRunner().run });

    expect(processor.when?.(contextFor(picked({ type })))).toBe(asks);
  });

  test("stops before the worker when the upload was already aborted", async () => {
    const { requests, run } = recordingRunner();
    const controller = new AbortController();
    controller.abort();

    await expect(
      upload(createImageProcessor({}, { run }), picked(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toHaveLength(0);
  });

  test("discards a result the caller gave up on", async () => {
    const controller = new AbortController();
    const run: ImageRunner = async () => {
      controller.abort();
      return { bytes: new Uint8Array(4), type: "image/webp" };
    };

    await expect(
      upload(createImageProcessor({}, { run }), picked(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("reports what the runner failed with", async () => {
    const run: ImageRunner = async () => {
      throw new Error("no codec for that");
    };

    await expect(upload(createImageProcessor({}, { run }))).rejects.toThrow("no codec for that");
  });

  test("needs a wasm location when no runner is given", () => {
    expect(() => createImageProcessor()).toThrow(/wasmUrl/);
  });
});

/** A worker the tests drive by hand, standing in for the module worker this package starts. */
class TestWorker {
  static started: TestWorker[] = [];

  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  readonly sent: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    TestWorker.started.push(this);
  }

  postMessage(message: WorkerRequest) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  /** Answers the request with that number. */
  answer(id: number, size = 2) {
    this.onmessage?.({ data: { bytes: new Uint8Array(size), id, type: "image/webp" } });
  }

  /** Answers it with a failure instead. */
  fail(id: number, error: string) {
    this.onmessage?.({ data: { error, id } });
  }

  /** Dies the way an uncaught error in a worker does. */
  crash(message = "worker crashed") {
    this.onerror?.({ message });
  }
}

const sentRequests = () => TestWorker.started.flatMap((worker) => worker.sent);

const workerAt = (index: number) => {
  const worker = TestWorker.started[index];
  if (!worker) throw new Error(`worker ${index} was never started`);
  return worker;
};

const sentAt = (index: number) => {
  const sent = sentRequests()[index];
  if (!sent) throw new Error(`request ${index} was never sent`);
  return sent;
};

describe("the worker it ships", () => {
  beforeEach(() => {
    TestWorker.started = [];
    vi.stubGlobal("Worker", TestWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("gives the worker the wasm location and a request number", async () => {
    const pending = upload(createImageProcessor({}, { wasmUrl }));

    await vi.waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentAt(0).request).toMatchObject({ format: "webp", wasmUrl });

    workerAt(0).answer(sentAt(0).id);
    await expect(pending).resolves.toMatchObject({ type: "image/webp" });
  });

  test("keeps one worker for every request it is given", async () => {
    const processor = createImageProcessor({}, { wasmUrl });

    const first = upload(processor);
    await vi.waitFor(() => expect(sentRequests()).toHaveLength(1));
    workerAt(0).answer(sentAt(0).id);
    await first;

    // A second request, left in flight: what matters is which worker it reaches.
    void upload(processor);
    await vi.waitFor(() => expect(sentRequests()).toHaveLength(2));

    expect(TestWorker.started).toHaveLength(1);
    expect(sentAt(1).id).toBe(sentAt(0).id + 1);
  });

  test("hands each answer to the request that asked for it", async () => {
    const processor = createImageProcessor({}, { wasmUrl });

    const first = upload(processor);
    const second = upload(processor);
    await vi.waitFor(() => expect(sentRequests()).toHaveLength(2));

    // Answered in the order the worker finished, not the order it was asked.
    workerAt(0).answer(sentAt(1).id, 2);
    workerAt(0).answer(sentAt(0).id, 3);

    await expect(second).resolves.toMatchObject({ size: 2 });
    await expect(first).resolves.toMatchObject({ size: 3 });
  });

  test("reports an answer that is an error as a failure", async () => {
    const pending = upload(createImageProcessor({}, { wasmUrl }));

    await vi.waitFor(() => expect(sentRequests()).toHaveLength(1));
    workerAt(0).fail(sentAt(0).id, "no codec for that");

    await expect(pending).rejects.toThrow("no codec for that");
  });

  test("ignores an answer to a request it never made", async () => {
    const pending = upload(createImageProcessor({}, { wasmUrl }));

    await vi.waitFor(() => expect(sentRequests()).toHaveLength(1));
    workerAt(0).answer(sentAt(0).id + 99, 1);
    workerAt(0).answer(sentAt(0).id, 5);

    await expect(pending).resolves.toMatchObject({ size: 5 });
  });

  test("takes a URL for the wasm location", async () => {
    const pending = upload(createImageProcessor({}, { wasmUrl: new URL(wasmUrl) }));

    await vi.waitFor(() => expect(sentRequests()).toHaveLength(1));
    expect(sentAt(0).request.wasmUrl).toBe(wasmUrl);

    workerAt(0).answer(sentAt(0).id);
    await pending;
  });

  test("fails what is in flight when the worker dies, and replaces it", async () => {
    const processor = createImageProcessor({}, { wasmUrl });

    const first = upload(processor);
    const second = upload(processor);
    await vi.waitFor(() => expect(sentRequests()).toHaveLength(2));

    workerAt(0).crash("out of memory");

    await expect(first).rejects.toThrow("out of memory");
    await expect(second).rejects.toThrow("out of memory");
    expect(workerAt(0).terminated).toBe(true);

    // The next request starts a fresh worker, which loads ImageMagick again.
    const third = upload(processor);
    await vi.waitFor(() => expect(TestWorker.started).toHaveLength(2));

    workerAt(1).answer(sentAt(2).id);
    await expect(third).resolves.toMatchObject({ size: 2 });
  });
});
