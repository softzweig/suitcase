import type { ByteStream } from "./storage.operations.js";

/**
 * Reads a body into one buffer, whichever form the caller passed.
 *
 * Lives beside {@link ByteStream} because every backend that cannot hand a
 * stream straight to its transport ends up needing it, and getting the two-pass
 * allocation right is the only fiddly part.
 */
export async function readBytes(body: Uint8Array | ByteStream): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;

  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);

  const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}
