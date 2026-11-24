import {
  AlphaAction,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickGeometry,
} from "@imagemagick/magick-wasm";
import {
  IMAGE_DEFAULTS,
  IMAGE_FORMATS,
  type ImageFormat,
  type ImageRequest,
  type ImageResult,
} from "./protocol.js";

const MAGICK_FORMATS = {
  gif: MagickFormat.Gif,
  jpeg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  webp: MagickFormat.WebP,
} as const satisfies Record<ImageFormat, MagickFormat>;

let loaded: Promise<void> | undefined;

/** Loads it once. A failed load is not cached, so a later message can try again. */
export const loadImageMagick = (wasmUrl: string) => {
  loaded ??= initializeImageMagick(new URL(wasmUrl)).catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });

  return loaded;
};

/**
 * Reads, shrinks and rewrites the image. Frames are coalesced first because a gif stores them as
 * deltas, and a delta frame is not a picture that can be resized on its own.
 *
 * Nothing here touches a worker global, so a Node worker can call it too.
 *
 * @human
 */
export const convertImage = ({
  bytes,
  background = IMAGE_DEFAULTS.background,
  format = IMAGE_DEFAULTS.format,
  quality = IMAGE_DEFAULTS.quality,
  maxDimension,
}: ImageRequest): ImageResult =>
  ImageMagick.readCollection(bytes, (images) => {
    images.coalesce();

    for (const image of images) {
      // A phone photo stores its rotation in EXIF, and the tag does not survive every format.
      image.autoOrient();

      if (maxDimension != null) {
        const bounds = new MagickGeometry(maxDimension, maxDimension);
        // Only ever shrink: an image already within the bounds keeps its size.
        bounds.greater = true;
        image.resize(bounds);
      }

      image.quality = quality;

      if (!IMAGE_FORMATS[format].alpha) {
        // A format without alpha would otherwise drop transparency onto black, whatever was asked.
        image.backgroundColor = new MagickColor(background);
        image.alpha(AlphaAction.Remove);
      }
    }

    return {
      // Copied inside the callback: what `write` hands back is a view of the wasm heap, which is
      // freed when the callback returns.
      bytes: images.write(MAGICK_FORMATS[format], (data) => data.slice()),
      type: IMAGE_FORMATS[format].mime,
    };
  });
