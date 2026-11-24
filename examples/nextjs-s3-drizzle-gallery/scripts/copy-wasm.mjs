import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * The image processor's worker fetches ImageMagick from the app's own origin, so the wasm is
 * copied into `public/` before the app starts. Turbopack has no asset import for it, and serving
 * it from `public/` is what a deployed app would do anyway.
 */
const require = createRequire(import.meta.url);
const wasm = require.resolve("@imagemagick/magick-wasm/magick.wasm");

await mkdir("public", { recursive: true });
await copyFile(wasm, "public/magick.wasm");
