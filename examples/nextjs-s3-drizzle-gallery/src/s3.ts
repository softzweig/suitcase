import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DATA } from "./paths";

/**
 * The S3 this example talks to: s3rver on the filesystem unless `S3_ENDPOINT` names a real
 * backend, so the app uses the real `@softzweig/suitcase-s3` adapter and needs no Docker.
 */
export const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:4568";

/** Uploads land in the first, resources are promoted into the second. */
export const UPLOADS_BUCKET = "gallery-uploads";
export const ASSETS_BUCKET = "gallery-assets";

const PORT = 4568;

/**
 * The browser uploads straight at the signed URL, which is a cross-origin request to this server,
 * so the buckets have to allow it. A real bucket needs the same policy.
 */
const CORS = `<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const cached = globalThis as typeof globalThis & { galleryS3?: Promise<void> };

/**
 * Starts s3rver, an S3 API on the filesystem, so the app talks to the real
 * `@softzweig/suitcase-s3` adapter instead of the example reimplementing one.
 *
 * Skipped when `S3_ENDPOINT` names a real backend.
 */
async function start() {
  if (process.env.S3_ENDPOINT) return;

  const directory = path.join(DATA, "s3");
  await mkdir(directory, { recursive: true });

  const { default: S3rver } = await import("@20minutes/s3rver");
  const server = new S3rver({
    address: "127.0.0.1",
    configureBuckets: [
      { configs: [CORS], name: UPLOADS_BUCKET },
      { configs: [CORS], name: ASSETS_BUCKET },
    ],
    directory,
    port: PORT,
    silent: true,
  });

  await server.run();
}

/** Called once from `instrumentation.ts`, before the first request. */
export function ensureLocalS3() {
  if (!cached.galleryS3) cached.galleryS3 = start();
  return cached.galleryS3;
}
