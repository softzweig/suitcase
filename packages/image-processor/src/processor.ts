import type { ProcessorContext, ProcessorRule } from "@softzweig/suitcase-client";
import {
  IMAGE_DEFAULTS,
  IMAGE_FORMATS,
  type ImageFormat,
  type ImageOptions,
  type ImageProcessorDependencies,
  type ImageRequest,
  type ImageResult,
} from "./protocol.js";
import { createWorkerRunner } from "./worker-runner.js";

/** The client's file, named through the context that declares it. */
type UploadFile = ProcessorContext["file"];

/** What a caller chooses: how the image is written, and which uploads it applies to. */
export type ImageProcessorOptions = ImageOptions & {
  /**
   * Narrows which uploads the rule applies to. The `image/*` check always holds, so this can only
   * exclude, never add. Given the same context the client gives every rule.
   */
  readonly when?: ProcessorRule["when"];
};

const extensionOf = (name: string) => /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? "";

const withoutExtension = (name: string) => name.replace(/\.[^./\\]+$/, "");

/** Anything that is not an image has no business in the worker. */
const isImage = ({ file }: ProcessorContext) => file.type.startsWith("image/");

/**
 * The worker's bytes, as a file the upload can claim: the name it came with when it already says
 * what the bytes are, and the format's first extension when it does not.
 */
function writtenFile(name: string, result: ImageResult, format: ImageFormat): UploadFile {
  const { extensions } = IMAGE_FORMATS[format];
  const extension = extensionOf(name);

  return {
    name: !extensions.some((known) => known === extension)
      ? `${withoutExtension(name)}${extensions[0]}`
      : name,
    size: result.bytes.byteLength,
    type: result.type,
    arrayBuffer: async () => result.bytes.slice().buffer,
  };
}

/**
 * Compresses and converts images in a worker, before the upload claims them.
 *
 * Only images are processed; anything else is handed on untouched. The result keeps the name, so
 * the claims and the kind's limits are checked against what will actually be sent.
 *
 * @example
 * ```ts
 * const client = createSuitcaseClient(definition, {
 *   processors: [createImageProcessor({ maxDimension: 1600 }, { wasmUrl })],
 * });
 * ```
 *
 * @human
 */
export function createImageProcessor(
  options: ImageProcessorOptions = {},
  dependencies: ImageProcessorDependencies = {},
): ProcessorRule {
  const {
    background = IMAGE_DEFAULTS.background,
    format = IMAGE_DEFAULTS.format,
    quality = IMAGE_DEFAULTS.quality,
    maxDimension,
    when,
  } = options;
  const run = dependencies.run ?? createWorkerRunner(dependencies.wasmUrl);

  return {
    name: "image",
    when: (context) => isImage(context) && (when?.(context) ?? true),
    process: async ({ value, signal }) => {
      signal?.throwIfAborted();

      const request: ImageRequest = {
        background,
        bytes: new Uint8Array(await value.arrayBuffer()),
        format,
        quality,
        maxDimension,
      };

      const result = await run(request, signal);

      // The bytes are written by now; a caller that gave up meanwhile gets the abort, not the result.
      signal?.throwIfAborted();

      return writtenFile(value.name, result, format);
    },
  };
}
