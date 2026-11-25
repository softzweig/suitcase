import { createSuitcaseClient } from "@softzweig/suitcase-client";
import { createSuitcaseOperations } from "@softzweig/suitcase-core/contracts";
import { createHttpTransport } from "@softzweig/suitcase-http";
import { createImageProcessor } from "@softzweig/suitcase-image-processor";
import { currentUser } from "../session";
import type { GalleryClient } from "./definition";

/**
 * The browser's client: operations at `/api/suitcase`, and the bytes PUT straight at the signed
 * URL the backend hands out, which is why no file ever passes through the operation endpoints.
 *
 * The acting user rides in a header, read per call rather than captured, so changing it in the UI
 * changes what the very next call claims. The digest is the package's default.
 *
 * The image processor is the only rule in the chain: an upload that is an image is shrunk and
 * written as webp in a worker before the bytes are claimed, everything else goes as it came. The
 * worker loads ImageMagick from `/magick.wasm`, which `scripts/copy-wasm.mjs` puts in `public/`.
 */
export const client = createSuitcaseClient<GalleryClient>({
  operations: createSuitcaseOperations<GalleryClient>({
    transport: createHttpTransport({
      configure: () => ({ headers: { "x-user": currentUser() } }),
      url: "/api/suitcase",
    }),
  }),
  processors: [
    createImageProcessor({ maxDimension: 1600, quality: 80 }, { wasmUrl: "/magick.wasm" }),
  ],
  transfer: async (target, bytes) => {
    const response = await fetch(target.url, {
      body: bytes,
      headers: target.headers,
      method: target.method,
    });

    if (!response.ok) {
      throw new Error(`The upload was refused (${response.status}).`);
    }
  },
});
