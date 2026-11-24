/** The formats this processor writes: every key of {@link IMAGE_FORMATS}. */
export type ImageFormat = keyof typeof IMAGE_FORMATS;

/** What the processor knows about a format it can write. */
export interface ImageFormatInfo {
  readonly mime: string;
  /** The spellings this format is written as; the first one is what a mismatched name becomes. */
  readonly extensions: readonly [string, ...string[]];
  /** Whether the format can keep transparency. */
  readonly alpha: boolean;
}

/** What an image is written as, before the worker sees it. */
export interface ImageOptions {
  /** Format to write. Defaults to `"webp"`. */
  readonly format?: ImageFormat;
  /** 1-100, higher keeps more detail. Defaults to `80`; a png reads it as its compression level. */
  readonly quality?: number;
  /** Longest edge in pixels; only larger images are scaled down. Omitted means no limit. */
  readonly maxDimension?: number;
  /**
   * What transparency is composited onto, for a format that cannot keep it. Defaults to `"white"`,
   * and is ignored when the format has alpha.
   */
  readonly background?: string;
}

/** What the processor needs from its environment. */
export interface ImageProcessorDependencies {
  /** Where the worker loads ImageMagick from. Required by the default runner. */
  readonly wasmUrl?: string | URL;
  /** Runs one image through a worker. Defaults to the one this package ships. */
  readonly run?: ImageRunner;
}

/** One image on its way through a worker. */
export interface ImageRequest extends ImageOptions {
  readonly bytes: Uint8Array;
}

/** What the worker wrote. */
export interface ImageResult {
  readonly bytes: Uint8Array;
  /** The mime type of what was written. */
  readonly type: string;
}

/** Sends one request to a worker. The seam a test, or Node, replaces. */
export type ImageRunner = (request: ImageRequest, signal?: AbortSignal) => Promise<ImageResult>;

/** The formats it writes. A new one goes here and into the worker's mapping. */
export const IMAGE_FORMATS = Object.freeze({
  gif: { alpha: true, extensions: [".gif"], mime: "image/gif" },
  jpeg: { alpha: false, extensions: [".jpg", ".jpeg"], mime: "image/jpeg" },
  png: { alpha: true, extensions: [".png"], mime: "image/png" },
  webp: { alpha: true, extensions: [".webp"], mime: "image/webp" },
} as const satisfies Record<string, ImageFormatInfo>);

/** Defaults in one place, so the processor and the worker cannot disagree. */
export const IMAGE_DEFAULTS = Object.freeze({
  background: "white",
  format: "webp",
  quality: 80,
});
