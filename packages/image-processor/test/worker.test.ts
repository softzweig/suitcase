import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { WorkerRequest } from "../src/worker.js";

const { convertImage, loadImageMagick } = vi.hoisted(() => ({
  convertImage: vi.fn(),
  loadImageMagick: vi.fn(),
}));

vi.mock("../src/convert.js", () => ({ convertImage, loadImageMagick }));

const wasmUrl = "https://cdn.test/magick.wasm";

/** The global a module worker runs in, standing in for the scope this module assigns to. */
const scope = {
  onmessage: null as ((event: { data: WorkerRequest }) => Promise<void> | void) | null,
  postMessage: vi.fn(),
};

const message = async (id: number) => {
  await scope.onmessage?.({
    data: { id, request: { bytes: new Uint8Array(2), format: "webp", wasmUrl } },
  });
};

beforeAll(async () => {
  vi.stubGlobal("self", scope);
  await import("../src/worker.js");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  scope.postMessage.mockReset();
  convertImage.mockReset();
  loadImageMagick.mockReset().mockResolvedValue(undefined);
});

describe("the worker module", () => {
  test("answers with what the converter wrote, under the same number", async () => {
    convertImage.mockReturnValue({ bytes: new Uint8Array(3), type: "image/webp" });

    await message(7);

    expect(loadImageMagick).toHaveBeenCalledWith(wasmUrl);
    expect(scope.postMessage).toHaveBeenCalledWith({
      id: 7,
      bytes: new Uint8Array(3),
      type: "image/webp",
    });
  });

  test("answers a failure instead of letting it escape", async () => {
    convertImage.mockImplementation(() => {
      throw new Error("no codec for that");
    });

    await message(8);

    expect(scope.postMessage).toHaveBeenCalledWith({ id: 8, error: "no codec for that" });
  });

  test("answers a thrown value that is not an error with a generic reason", async () => {
    loadImageMagick.mockRejectedValue("nope");

    await message(9);

    expect(scope.postMessage).toHaveBeenCalledWith({ id: 9, error: "Image conversion failed" });
  });
});
