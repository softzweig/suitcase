import type { ImageResult, ImageRunner } from "./protocol.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

/** How an answer is handed to the request waiting for it. */
type Pending = Readonly<{
  resolve(result: ImageResult): void;
  reject(error: unknown): void;
}>;

/**
 * One worker per processor, started on first use: loading the wasm is the expensive part.
 *
 * Requests are numbered, so two uploads in flight cannot take each other's answers, and a worker
 * that dies takes the answers it owed with it. The next request starts a fresh one.
 */
export function createWorkerRunner(wasmUrl: string | URL | undefined): ImageRunner {
  if (!wasmUrl) {
    throw new Error(
      "The image processor needs `wasmUrl` to load ImageMagick, or a `run` that loads it itself.",
    );
  }

  const location = String(wasmUrl);
  const pending = new Map<number, Pending>();
  let worker: Worker | undefined;
  let nextId = 0;

  const connect = () => {
    if (worker) return worker;

    const started = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

    started.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const settle = pending.get(data.id);
      if (!settle) return;

      pending.delete(data.id);
      if ("error" in data) settle.reject(new Error(data.error));
      else settle.resolve(data);
    };

    started.onerror = ({ message }: ErrorEvent) => {
      for (const settle of pending.values()) settle.reject(new Error(message));
      pending.clear();
      started.terminate();
      worker = undefined;
    };

    worker = started;
    return started;
  };

  return (request) =>
    new Promise<ImageResult>((resolve, reject) => {
      const id = nextId++;

      pending.set(id, { reject, resolve });
      connect().postMessage({
        id,
        request: { ...request, wasmUrl: location },
      } satisfies WorkerRequest);
    });
}
