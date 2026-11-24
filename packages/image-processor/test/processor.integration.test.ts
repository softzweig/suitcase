import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
  MagickImage,
  MagickImageCollection,
} from "@imagemagick/magick-wasm";
import {
  type ProcessorContext,
  type ProcessorRule,
  runFileProcessors,
} from "@softzweig/suitcase-client";
import { beforeAll, describe, expect, expectTypeOf, test } from "vitest";
import { convertImage } from "../src/convert.js";
import { createImageProcessor, type ImageRunner } from "../src/index.js";

type UploadFile = ProcessorContext["file"];

/** 1x1 png, the source every case starts from. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const constraints = { hasIntent: false, maxSize: null, mimeTypes: null };

const picked = (bytes: Uint8Array, name = "cat.png", type = "image/png"): UploadFile => ({
  name,
  size: bytes.byteLength,
  type,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
});

/** An animated gif: `count` 1x1 frames, alternating red and blue. */
function animated(count: number) {
  const images = MagickImageCollection.create();
  for (let index = 0; index < count; index++) {
    images.push(MagickImage.create(index % 2 ? MagickColors.Red : MagickColors.Blue, 1, 1));
  }

  try {
    return images.write(MagickFormat.Gif, (data) => data.slice());
  } finally {
    images.dispose();
  }
}

/** Runs the rules the way an upload does: the file as picked, and what it is being uploaded as. */
const uploaded = (rules: readonly ProcessorRule[], file: UploadFile) =>
  runFileProcessors({ constraints, file, kind: "avatar", rules });

/** The same image grown to a real size, so a resize has something to do. */
const grown = (width: number, height: number) =>
  ImageMagick.read(PNG, (image) => {
    image.extent(width, height, MagickColors.Transparent);
    // Sliced inside the callback, like the converter does: the buffer is freed afterwards.
    return image.write(MagickFormat.Png, (data) => data.slice());
  });

const dimensions = (bytes: Uint8Array) =>
  ImageMagick.read(bytes, (image) => ({ height: image.height, width: image.width }));

const framesOf = (bytes: Uint8Array) =>
  ImageMagick.readCollection(bytes, (images) => images.length);

/** The brightest channel of the top-left pixel, in whatever range the image is stored in. */
const firstPixel = (bytes: Uint8Array) =>
  ImageMagick.read(bytes, (image) =>
    image.getPixels((pixels) => Math.max(...pixels.getPixel(0, 0))),
  );

const head = (bytes: Uint8Array, from: number, to: number) =>
  new TextDecoder().decode(bytes.subarray(from, to));

/** The worker's body, called without a worker: the same conversion, on this thread. */
const run: ImageRunner = async (request) => convertImage(request);

beforeAll(async () => {
  // The library fetches a URL, which Node cannot do for `file:`; feeding it the bytes is the same
  // instance, and the only thing the browser-only URL path adds is the fetch.
  const wasm = createRequire(import.meta.url).resolve("@imagemagick/magick-wasm/magick.wasm");
  await initializeImageMagick(new Uint8Array(await readFile(wasm)));
});

describe("an image through the client and the wasm", () => {
  test("becomes a webp the upload can claim", async () => {
    const result = await uploaded([createImageProcessor({}, { run })], picked(PNG));

    const bytes = new Uint8Array(await result.arrayBuffer());

    expect(result).toMatchObject({ name: "cat.webp", type: "image/webp" });
    expect(head(bytes, 0, 4)).toBe("RIFF");
    expect(head(bytes, 8, 12)).toBe("WEBP");
    expect(result.size).toBe(bytes.byteLength);
  });

  test("becomes a jpeg when that is what was asked for", async () => {
    const result = await uploaded([createImageProcessor({ format: "jpeg" }, { run })], picked(PNG));

    const bytes = new Uint8Array(await result.arrayBuffer());

    expect(result).toMatchObject({ name: "cat.jpg", type: "image/jpeg" });
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test("is scaled down to the longest edge that was allowed", async () => {
    const source = grown(64, 32);

    const result = await uploaded(
      [createImageProcessor({ maxDimension: 32 }, { run })],
      picked(source),
    );

    expect(dimensions(new Uint8Array(await result.arrayBuffer()))).toEqual({
      height: 16,
      width: 32,
    });
  });

  test("keeps an image that is already within the limit at its size", async () => {
    const result = await uploaded(
      [createImageProcessor({ maxDimension: 32 }, { run })],
      picked(PNG),
    );

    expect(dimensions(new Uint8Array(await result.arrayBuffer()))).toEqual({
      height: 1,
      width: 1,
    });
  });

  test("keeps every frame of an animated gif", async () => {
    const result = await uploaded(
      [createImageProcessor({ format: "gif" }, { run })],
      picked(animated(3), "cat.gif", "image/gif"),
    );

    expect(result).toMatchObject({ name: "cat.gif", type: "image/gif" });
    expect(framesOf(new Uint8Array(await result.arrayBuffer()))).toBe(3);
  });

  test("composites what was transparent onto the background it was given", async () => {
    const source = grown(4, 4);
    const corner = async (background: string) => {
      const rule = createImageProcessor({ background, format: "jpeg" }, { run });

      return firstPixel(
        new Uint8Array(await (await uploaded([rule], picked(source))).arrayBuffer()),
      );
    };

    const dark = await corner("black");
    const light = await corner("white");

    expect(dark).toBeLessThan(light / 4);
  });
});

describe("the rule a client is handed", () => {
  test("is the client's own rule type, and its run hands the client's file back", () => {
    const rule = createImageProcessor({}, { run });

    expectTypeOf(rule).toExtend<ProcessorRule>();
    expectTypeOf(uploaded([rule], picked(PNG))).resolves.toEqualTypeOf<UploadFile>();
  });
});
