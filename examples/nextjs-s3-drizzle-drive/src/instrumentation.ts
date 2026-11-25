/**
 * Next calls this once when the server starts, before the first request: the local S3 has to be
 * listening before an upload asks for a signed URL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await (await import("./s3")).ensureLocalS3();
}
