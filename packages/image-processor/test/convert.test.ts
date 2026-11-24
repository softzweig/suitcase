import { beforeEach, describe, expect, test, vi } from "vitest";

const { initializeImageMagick } = vi.hoisted(() => ({ initializeImageMagick: vi.fn() }));

vi.mock("@imagemagick/magick-wasm", () => ({
  ImageMagick: { readCollection: vi.fn() },
  initializeImageMagick,
  MagickFormat: { Gif: "GIF", Jpeg: "JPEG", Png: "PNG", WebP: "WEBP" },
  MagickGeometry: class {},
}));

const wasmUrl = "https://cdn.test/magick.wasm";

describe("loadImageMagick", () => {
  beforeEach(() => {
    // `loaded` is module state, so every test starts from a module that never loaded the wasm.
    vi.resetModules();
    initializeImageMagick.mockReset();
  });

  test("loads once, and tries again after a failure", async () => {
    initializeImageMagick.mockRejectedValueOnce(new Error("the wasm is unreachable"));
    initializeImageMagick.mockResolvedValue(undefined);

    const { loadImageMagick } = await import("../src/convert.js");

    await expect(loadImageMagick(wasmUrl)).rejects.toThrow("the wasm is unreachable");
    await expect(loadImageMagick(wasmUrl)).resolves.toBeUndefined();
    await loadImageMagick(wasmUrl);

    // The retry is the second call; the third reused it.
    expect(initializeImageMagick).toHaveBeenCalledTimes(2);
    expect(initializeImageMagick).toHaveBeenCalledWith(new URL(wasmUrl));
  });

  test("resolves a path against the page that started the worker", async () => {
    initializeImageMagick.mockResolvedValue(undefined);
    vi.stubGlobal("location", { href: "https://app.test/gallery" });

    const { loadImageMagick } = await import("../src/convert.js");

    await loadImageMagick("/magick.wasm");

    expect(initializeImageMagick).toHaveBeenCalledWith(new URL("https://app.test/magick.wasm"));
    vi.unstubAllGlobals();
  });
});
