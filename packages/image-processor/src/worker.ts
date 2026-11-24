import { convertImage, loadImageMagick } from "./convert.js";
import type { ImageRequest, ImageResult } from "./protocol.js";

/** A request, numbered so its answer can find it. */
export interface WorkerRequest {
  readonly id: number;
  readonly request: ImageRequest & { readonly wasmUrl: string };
}

/** The result, or why the worker could not write one. */
export type WorkerResponse =
  | ({ readonly id: number } & ImageResult)
  | { readonly id: number; readonly error: string };

/** The worker global, narrowed to what this file uses: the DOM lib types `self` as a window. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

/** What an unknown thrown value says, for a reply that can only carry a string. */
const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : "Image conversion failed";

scope.onmessage = async ({ data: { id, request } }) => {
  try {
    await loadImageMagick(request.wasmUrl);
    scope.postMessage({ id, ...convertImage(request) });
  } catch (error) {
    scope.postMessage({ id, error: reasonOf(error) });
  }
};
